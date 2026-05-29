import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  deleteTask,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getDueTasks,
  getLastGroupSync,
  getRegisteredGroup,
  getRouterState,
  getSession,
  getTaskById,
  getTasksForGroup,
  logTaskRun,
  setLastGroupSync,
  setRegisteredGroup,
  setRouterState,
  setSession,
  updateTask,
  updateTaskAfterRun,
} from './db.js';
import { RegisteredGroup } from './types.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('router_state accessors', () => {
  it('returns undefined for an unset key', () => {
    expect(getRouterState('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    setRouterState('last_timestamp', '2026-01-01T00:00:00.000Z');
    expect(getRouterState('last_timestamp')).toBe('2026-01-01T00:00:00.000Z');
  });

  it('overwrites an existing value', () => {
    setRouterState('k', 'one');
    setRouterState('k', 'two');
    expect(getRouterState('k')).toBe('two');
  });
});

describe('session accessors', () => {
  it('returns undefined for an unknown group', () => {
    expect(getSession('nobody')).toBeUndefined();
  });

  it('stores, overwrites, and lists sessions', () => {
    setSession('main', 'sess-1');
    setSession('other', 'sess-2');
    setSession('main', 'sess-1b'); // overwrite
    expect(getSession('main')).toBe('sess-1b');
    expect(getAllSessions()).toEqual({ main: 'sess-1b', other: 'sess-2' });
  });
});

describe('group sync timestamp', () => {
  it('returns null before any sync', () => {
    expect(getLastGroupSync()).toBeNull();
  });

  it('records a sync timestamp', () => {
    setLastGroupSync();
    const ts = getLastGroupSync();
    expect(ts).not.toBeNull();
    expect(() => new Date(ts!).toISOString()).not.toThrow();
  });
});

describe('registered group accessors', () => {
  const group: RegisteredGroup = {
    name: 'Main',
    folder: 'main',
    trigger: 'always',
    added_at: '2026-01-01T00:00:00.000Z',
  };

  it('round-trips a group including containerConfig and requiresTrigger', () => {
    const withConfig: RegisteredGroup = {
      ...group,
      requiresTrigger: false,
      containerConfig: {
        additionalMounts: [{ hostPath: '/data', containerPath: 'data' }],
      },
    };
    setRegisteredGroup('main@g.us', withConfig);
    const loaded = getRegisteredGroup('main@g.us');
    expect(loaded).toMatchObject({
      jid: 'main@g.us',
      name: 'Main',
      folder: 'main',
      trigger: 'always',
      requiresTrigger: false,
    });
    expect(loaded!.containerConfig?.additionalMounts?.[0].hostPath).toBe(
      '/data',
    );
  });

  it('defaults requiresTrigger to true when unspecified', () => {
    setRegisteredGroup('main@g.us', group);
    expect(getRegisteredGroup('main@g.us')!.requiresTrigger).toBe(true);
  });

  it('returns undefined for an unknown jid', () => {
    expect(getRegisteredGroup('nope@g.us')).toBeUndefined();
  });

  it('lists all registered groups keyed by jid', () => {
    setRegisteredGroup('a@g.us', { ...group, folder: 'a' });
    setRegisteredGroup('b@g.us', { ...group, folder: 'b' });
    const all = getAllRegisteredGroups();
    expect(Object.keys(all).sort()).toEqual(['a@g.us', 'b@g.us']);
  });

  it('rejects an unsafe folder on write', () => {
    expect(() =>
      setRegisteredGroup('x@g.us', { ...group, folder: '../escape' }),
    ).toThrow(/invalid group folder/i);
  });
});

describe('scheduled task accessors', () => {
  function makeTask(overrides: Partial<Parameters<typeof createTask>[0]> = {}) {
    createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'main@g.us',
      prompt: 'do thing',
      schedule_type: 'interval',
      schedule_value: '60000',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 1000).toISOString(),
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });
  }

  it('lists tasks for a group and across all groups', () => {
    makeTask({ id: 'task-1', group_folder: 'main' });
    makeTask({ id: 'task-2', group_folder: 'other' });
    expect(getTasksForGroup('main').map((t) => t.id)).toEqual(['task-1']);
    expect(getAllTasks()).toHaveLength(2);
  });

  it('returns only active, due tasks from getDueTasks', () => {
    makeTask({
      id: 'due',
      next_run: new Date(Date.now() - 1000).toISOString(),
    });
    makeTask({
      id: 'future',
      next_run: new Date(Date.now() + 60_000).toISOString(),
    });
    makeTask({
      id: 'paused',
      status: 'paused',
      next_run: new Date(Date.now() - 1000).toISOString(),
    });
    makeTask({ id: 'no-next', next_run: null });
    expect(getDueTasks().map((t) => t.id)).toEqual(['due']);
  });

  it('updates editable fields via updateTask', () => {
    makeTask();
    updateTask('task-1', { prompt: 'new prompt', status: 'paused' });
    const t = getTaskById('task-1')!;
    expect(t.prompt).toBe('new prompt');
    expect(t.status).toBe('paused');
  });

  it('updateTaskAfterRun keeps a recurring task active and advances next_run', () => {
    makeTask();
    const next = new Date(Date.now() + 60_000).toISOString();
    updateTaskAfterRun('task-1', next, 'ok');
    const t = getTaskById('task-1')!;
    expect(t.next_run).toBe(next);
    expect(t.last_result).toBe('ok');
    expect(t.status).toBe('active');
    expect(t.last_run).not.toBeNull();
  });

  it('updateTaskAfterRun marks a one-shot task completed when next_run is null', () => {
    makeTask({ schedule_type: 'once' });
    updateTaskAfterRun('task-1', null, 'done');
    expect(getTaskById('task-1')!.status).toBe('completed');
  });

  it('deleteTask removes the task and its run logs', () => {
    makeTask();
    logTaskRun({
      task_id: 'task-1',
      run_at: new Date().toISOString(),
      duration_ms: 5,
      status: 'success',
      result: 'r',
      error: null,
    });
    deleteTask('task-1');
    expect(getTaskById('task-1')).toBeUndefined();
  });
});
