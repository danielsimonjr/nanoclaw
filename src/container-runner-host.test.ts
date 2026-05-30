import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  DATA_DIR: '/tmp/nanoclaw-host-test/data',
  GROUPS_DIR: '/tmp/nanoclaw-host-test/groups',
  IDLE_TIMEOUT: 1800000,
  TIMEZONE: 'UTC',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Force host mode.
vi.mock('./container-runtime.js', () => ({
  isHostMode: () => true,
  CONTAINER_RUNTIME_BIN: 'docker',
  bindMountArgs: () => [],
  readonlyMountArgs: () => [],
  stopContainer: (n: string) => `docker stop ${n}`,
}));

vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

vi.mock('./group-folder.js', () => ({
  resolveGroupFolderPath: (f: string) => `/tmp/nanoclaw-host-test/groups/${f}`,
  resolveGroupIpcPath: (f: string) => `/tmp/nanoclaw-host-test/data/ipc/${f}`,
}));

// Control whether the built agent-runner entry "exists".
const agentBuilt = vi.hoisted(() => ({ exists: false }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) =>
        p.endsWith(`agent-runner/dist/index.js`) ? agentBuilt.exists : false,
      ),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      cpSync: vi.fn(),
    },
  };
});

const spawnMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, spawn: spawnMock.fn, exec: vi.fn() };
});

import { runContainerAgent, ContainerInput } from './container-runner.js';
import { RegisteredGroup } from './types.js';

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  return proc;
}

const GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2026-01-01T00:00:00.000Z',
};

const INPUT: ContainerInput = {
  prompt: 'hello',
  groupFolder: 'main',
  chatJid: 'main@g.us',
  isMain: true,
};

beforeEach(() => {
  spawnMock.fn.mockReset();
  agentBuilt.exists = false;
});

describe('host mode dispatch', () => {
  it('returns a clear error when the agent-runner is not built', async () => {
    agentBuilt.exists = false;
    const result = await runContainerAgent(
      GROUP,
      { ...INPUT },
      () => {},
      async () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/agent-runner to be built/i);
    expect(spawnMock.fn).not.toHaveBeenCalled();
  });

  it('spawns node against the built agent-runner with workspace env vars', async () => {
    agentBuilt.exists = true;
    const proc = makeFakeProc();
    spawnMock.fn.mockReturnValue(proc);

    const promise = runContainerAgent(
      GROUP,
      { ...INPUT },
      () => {},
      async () => {},
    );

    // Let the spawn happen, then complete the run.
    await new Promise((r) => setImmediate(r));

    expect(spawnMock.fn).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = spawnMock.fn.mock.calls[0];
    expect(bin).toBe(process.execPath);
    expect(args[0]).toMatch(/agent-runner[\\/]dist[\\/]index\.js$/);
    expect(opts.env.NANOCLAW_GROUP_DIR).toBe(
      '/tmp/nanoclaw-host-test/groups/main',
    );
    expect(opts.env.NANOCLAW_IPC_DIR).toBe(
      '/tmp/nanoclaw-host-test/data/ipc/main',
    );
    expect(opts.cwd).toBe('/tmp/nanoclaw-host-test/groups/main');

    // Emit a final result and close so the promise resolves.
    proc.stdout.write(
      `${OUTPUT_START_MARKER}${JSON.stringify({ status: 'success', result: 'done' })}${OUTPUT_END_MARKER}`,
    );
    proc.emit('close', 0);

    const result = await promise;
    expect(result.status).toBe('success');

    // A per-run log is written (parity with container mode).
    const fsMock = (await import('fs')).default;
    const wroteRunLog = (
      fsMock.writeFileSync as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.some((c: unknown[]) => String(c[0]).includes('agent-'));
    expect(wroteRunLog).toBe(true);
  });
});
