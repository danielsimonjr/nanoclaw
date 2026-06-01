import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  getTaskById,
  setRegisteredGroup,
} from './db.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

// Mutable mock for the container agent invocation.
const agent = vi.hoisted(() => ({
  impl: null as ((onOutput?: (o: any) => Promise<void>) => Promise<any>) | null,
}));

vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn(
    async (
      _group: unknown,
      _input: unknown,
      _onProcess: unknown,
      onOutput?: (o: any) => Promise<void>,
    ) => {
      return agent.impl!(onOutput);
    },
  ),
  writeTasksSnapshot: vi.fn(),
}));

// Avoid touching the real filesystem / groups directory, but keep the real
// folder validation (db.ts relies on isValidGroupFolder).
vi.mock('./group-folder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./group-folder.js')>();
  return {
    ...actual,
    resolveGroupFolderPath: (folder: string) => `/tmp/nanoclaw-test/${folder}`,
  };
});

vi.mock('fs', () => ({
  default: { mkdirSync: vi.fn() },
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  _resetSchedulerLoopForTests,
  startSchedulerLoop,
  SchedulerDependencies,
} from './task-scheduler.js';

const GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2026-01-01T00:00:00.000Z',
};

function makeDueTask(overrides: Partial<ScheduledTask> = {}): void {
  createTask({
    id: 'task-run',
    group_folder: 'main',
    chat_jid: 'main@g.us',
    prompt: 'do the thing',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

let sendMessage: SchedulerDependencies['sendMessage'] &
  ReturnType<typeof vi.fn>;
let deps: SchedulerDependencies;

beforeEach(() => {
  _initTestDatabase();
  _resetSchedulerLoopForTests();
  setRegisteredGroup('main@g.us', GROUP);
  agent.impl = null;
  sendMessage = vi.fn(async () => {});
  deps = {
    registeredGroups: () => ({ 'main@g.us': GROUP }),
    getSessions: () => ({}),
    queue: {
      // Run the queued task immediately and synchronously await it.
      enqueueTask: vi.fn((_jid: string, _id: string, fn: () => Promise<void>) =>
        fn(),
      ),
      closeStdin: vi.fn(),
      notifyIdle: vi.fn(),
    } as unknown as SchedulerDependencies['queue'],
    onProcess: vi.fn(),
    sendMessage,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

// The loop schedules the next iteration with setTimeout; since enqueueTask runs
// the task synchronously, awaiting a microtask flush is enough to observe the
// result of the first iteration.
async function runOnce(): Promise<void> {
  startSchedulerLoop(deps);
  await vi.waitFor(() => {
    // task should have been touched by the run
    const t = getTaskById('task-run');
    expect(t?.last_run ?? null).not.toBeNull();
  });
}

describe('runTask (via scheduler loop)', () => {
  it('runs a due task, forwards the result, and advances next_run', async () => {
    makeDueTask();
    agent.impl = async (onOutput) => {
      await onOutput?.({ status: 'success', result: 'hello user' });
      return { status: 'success', result: 'hello user' };
    };

    await runOnce();

    expect(sendMessage).toHaveBeenCalledWith('main@g.us', 'hello user');
    const t = getTaskById('task-run')!;
    expect(t.status).toBe('active'); // interval task stays active
    expect(t.next_run).not.toBeNull();
    expect(new Date(t.next_run!).getTime()).toBeGreaterThan(Date.now());
    expect(t.last_result).toBe('hello user');
  });

  it('records an error result when the agent returns status=error', async () => {
    makeDueTask();
    agent.impl = async () => ({
      status: 'error',
      result: null,
      error: 'boom',
    });

    await runOnce();

    const t = getTaskById('task-run')!;
    expect(t.last_result).toMatch(/^Error: boom/);
    // An interval task still gets a future next_run and is not paused.
    expect(t.status).toBe('active');
    expect(t.next_run).not.toBeNull();
  });

  it('records an error when the agent invocation throws', async () => {
    makeDueTask();
    agent.impl = async () => {
      throw new Error('container crashed');
    };

    await runOnce();

    expect(getTaskById('task-run')!.last_result).toMatch(/container crashed/);
  });

  it('completes a one-shot task by clearing next_run', async () => {
    makeDueTask({
      schedule_type: 'once',
      schedule_value: '2026-01-01T00:00:00.000Z',
    });
    agent.impl = async () => ({ status: 'success', result: 'done' });

    await runOnce();

    const t = getTaskById('task-run')!;
    expect(t.status).toBe('completed');
    expect(t.next_run).toBeNull();
  });

  it('pauses a task whose cron value is malformed instead of looping', async () => {
    makeDueTask({ schedule_type: 'cron', schedule_value: 'not a cron' });
    agent.impl = async () => ({ status: 'success', result: 'ok' });

    startSchedulerLoop(deps);
    await vi.waitFor(() => {
      expect(getTaskById('task-run')!.status).toBe('paused');
    });
    // Paused, so it will not be re-enqueued every poll.
    expect(getTaskById('task-run')!.status).toBe('paused');
  });

  it('pauses an interval task whose value overflows the Date range', async () => {
    makeDueTask({
      schedule_type: 'interval',
      schedule_value: '99999999999999999999',
    });
    agent.impl = async () => ({ status: 'success', result: 'ok' });

    startSchedulerLoop(deps);
    await vi.waitFor(() => {
      expect(getTaskById('task-run')!.status).toBe('paused');
    });
    expect(getTaskById('task-run')!.status).toBe('paused');
  });

  it('pauses (does not complete) a one-shot task that errors', async () => {
    makeDueTask({
      schedule_type: 'once',
      schedule_value: '2026-01-01T00:00:00.000Z',
    });
    agent.impl = async () => ({ status: 'error', result: null, error: 'boom' });

    startSchedulerLoop(deps);
    await vi.waitFor(() => {
      expect(getTaskById('task-run')!.status).toBe('paused');
    });
    // Not silently completed — preserved for the user to inspect/retry.
    expect(getTaskById('task-run')!.status).toBe('paused');
  });

  it('does not invoke the agent when the group is unregistered', async () => {
    makeDueTask({ group_folder: 'ghost' });
    const { runContainerAgent } = await import('./container-runner.js');
    agent.impl = async () => ({ status: 'success', result: 'x' });

    // This path is fully synchronous (early return before any await), so the
    // run has already completed once startSchedulerLoop returns.
    startSchedulerLoop(deps);
    await vi.waitFor(() => {
      expect(deps.queue.enqueueTask).toHaveBeenCalled();
    });

    expect(runContainerAgent).not.toHaveBeenCalled();
    // The early-return path logs a run but never calls updateTaskAfterRun,
    // so the task's own last_run/last_result are left untouched.
    expect(getTaskById('task-run')!.last_result).toBeNull();
  });
});
