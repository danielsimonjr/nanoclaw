import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// A real (non-mocked) end-to-end exercise of host mode: runContainerAgent in
// host mode spawns an actual Node child process (the "agent-runner"), feeds it
// the ContainerInput over stdin, and parses the OUTPUT markers it streams back.
// We substitute a tiny fake agent-runner so no Claude credentials are needed.
// This runs on whatever OS the test runs on (incl. Windows CI), proving the
// host spawn/stdin/stdout protocol works cross-platform.

const h = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const ROOT = path.join(os.tmpdir(), 'nanoclaw-host-e2e');
  return {
    ROOT,
    PROJECT: path.join(ROOT, 'project'),
    DATA_DIR: path.join(ROOT, 'data'),
    GROUPS_DIR: path.join(ROOT, 'groups'),
  };
});
const { ROOT, PROJECT, DATA_DIR, GROUPS_DIR } = h;

// The fake agent-runner: reads stdin JSON, then echoes a result back wrapped in
// the OUTPUT markers, and exits 0. Mirrors the real runner's stdout protocol.
const FAKE_AGENT_RUNNER = `
import fs from 'fs';
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(data); } catch {}
  const out = {
    status: 'success',
    result: 'echo:' + (input.prompt || ''),
    newSessionId: 'host-session-1',
  };
  process.stdout.write('${OUTPUT_START_MARKER}\\n' + JSON.stringify(out) + '\\n${OUTPUT_END_MARKER}\\n');
  process.exit(0);
});
`;

vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  DATA_DIR: h.DATA_DIR,
  GROUPS_DIR: h.GROUPS_DIR,
  IDLE_TIMEOUT: 1800000,
  TIMEZONE: 'UTC',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Force host mode (real driveAgentProcess + real spawn, no further mocking).
vi.mock('./container-runtime.js', () => ({
  isHostMode: () => true,
  CONTAINER_RUNTIME_BIN: 'docker',
  bindMountArgs: () => [],
  getContainerSpawnCommand: () => 'docker',
  stopContainer: (n: string) => `docker stop ${n}`,
}));

vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

vi.mock('./env.js', () => ({ readEnvFile: () => ({}) }));

vi.mock('./group-folder.js', () => {
  const p = require('path') as typeof import('path');
  return {
    resolveGroupFolderPath: (f: string) => p.join(h.GROUPS_DIR, f),
    resolveGroupIpcPath: (f: string) => p.join(h.DATA_DIR, 'ipc', f),
  };
});

vi.mock('./fs-sync.js', () => ({ syncDirIfChanged: vi.fn() }));

import { runContainerAgent, ContainerInput } from './container-runner.js';
import { RegisteredGroup } from './types.js';

const GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2026-01-01T00:00:00.000Z',
};

const INPUT: ContainerInput = {
  prompt: 'hello host',
  groupFolder: 'main',
  chatJid: 'main@g.us',
  isMain: true,
};

beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  // Lay down the fake built agent-runner where host mode looks for it:
  // <cwd>/container/agent-runner/dist/index.js
  const distDir = path.join(PROJECT, 'container', 'agent-runner', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.js'), FAKE_AGENT_RUNNER);
  fs.mkdirSync(GROUPS_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(PROJECT);
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('host mode (real spawn, end-to-end protocol)', () => {
  it('spawns the agent-runner, sends input over stdin, and streams the result', async () => {
    const seen: unknown[] = [];
    const result = await runContainerAgent(
      GROUP,
      { ...INPUT },
      () => {},
      async (o) => {
        seen.push(o);
      },
    );

    // The streamed marker was parsed and delivered to onOutput...
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      status: 'success',
      result: 'echo:hello host',
      newSessionId: 'host-session-1',
    });
    // ...and the run resolved successfully with the session id captured.
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('host-session-1');

    // A per-run log was written to the group's logs dir.
    const logsDir = path.join(GROUPS_DIR, 'main', 'logs');
    const logs = fs.existsSync(logsDir) ? fs.readdirSync(logsDir) : [];
    expect(logs.some((f) => f.startsWith('agent-'))).toBe(true);
  });

  it('reports a clear error when the agent-runner is not built', async () => {
    fs.rmSync(path.join(PROJECT, 'container', 'agent-runner', 'dist'), {
      recursive: true,
      force: true,
    });
    const result = await runContainerAgent(
      GROUP,
      { ...INPUT },
      () => {},
      async () => {},
    );
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/build:agent/);
  });
});
