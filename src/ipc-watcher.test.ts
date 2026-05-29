import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const h = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const DATA_DIR = path.join(os.tmpdir(), 'nanoclaw-ipc-watcher-test');
  return { DATA_DIR };
});

vi.mock('./config.js', () => ({
  DATA_DIR: h.DATA_DIR,
  // Large interval so the self-rescheduling loop does not fire again during
  // a test; the initial pass runs synchronously on start.
  IPC_POLL_INTERVAL: 1_000_000,
  MAIN_GROUP_FOLDER: 'main',
  TIMEZONE: 'UTC',
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { _initTestDatabase, setRegisteredGroup, getAllTasks } from './db.js';
import { startIpcWatcher, _resetIpcWatcherForTests, IpcDeps } from './ipc.js';
import { RegisteredGroup } from './types.js';

const IPC_DIR = path.join(h.DATA_DIR, 'ipc');
const ERRORS_DIR = path.join(IPC_DIR, 'errors');

const OTHER_GROUP: RegisteredGroup = {
  name: 'Other',
  folder: 'other',
  trigger: '@Andy',
  added_at: '2026-01-01T00:00:00.000Z',
};

function writeIpcFile(
  group: string,
  kind: 'messages' | 'tasks',
  name: string,
  body: unknown,
): string {
  const dir = path.join(IPC_DIR, group, kind);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    typeof body === 'string' ? body : JSON.stringify(body),
  );
  return file;
}

let sendMessage: ReturnType<typeof vi.fn>;
let deps: IpcDeps;

beforeEach(() => {
  fs.rmSync(h.DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(IPC_DIR, { recursive: true });
  _initTestDatabase();
  _resetIpcWatcherForTests();
  vi.useFakeTimers();

  // 'other' group owns chat 'other@g.us'.
  setRegisteredGroup('other@g.us', OTHER_GROUP);

  sendMessage = vi.fn(async () => {});
  deps = {
    sendMessage: sendMessage as unknown as IpcDeps['sendMessage'],
    registeredGroups: () => ({ 'other@g.us': OTHER_GROUP }),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(async () => {}),
    getAvailableGroups: () => [],
    writeGroupsSnapshot: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// Drain the initial (synchronous) pass of the watcher, including its awaits.
async function runWatcherOnce(): Promise<void> {
  startIpcWatcher(deps);
  await vi.advanceTimersByTimeAsync(0);
}

describe('IPC watcher — message authorization', () => {
  it('delivers an authorized message and consumes the file', async () => {
    const file = writeIpcFile('other', 'messages', 'm1.json', {
      type: 'message',
      chatJid: 'other@g.us',
      text: 'hi',
    });

    await runWatcherOnce();

    expect(sendMessage).toHaveBeenCalledWith('other@g.us', 'hi');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('blocks a non-main group sending to a chat it does not own', async () => {
    // 'other' group tries to message a chat that is not theirs.
    const file = writeIpcFile('other', 'messages', 'm2.json', {
      type: 'message',
      chatJid: 'someone-else@g.us',
      text: 'spoof',
    });

    await runWatcherOnce();

    expect(sendMessage).not.toHaveBeenCalled();
    // The file is still consumed so it does not loop forever.
    expect(fs.existsSync(file)).toBe(false);
  });

  it('lets the main group send to any chat', async () => {
    writeIpcFile('main', 'messages', 'm3.json', {
      type: 'message',
      chatJid: 'anything@g.us',
      text: 'broadcast',
    });

    await runWatcherOnce();

    expect(sendMessage).toHaveBeenCalledWith('anything@g.us', 'broadcast');
  });

  it('quarantines a malformed message file in the errors directory', async () => {
    writeIpcFile('other', 'messages', 'bad.json', '{ not json');

    await runWatcherOnce();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(ERRORS_DIR, 'other-bad.json'))).toBe(true);
  });

  it('ignores the reserved "errors" directory when scanning groups', async () => {
    fs.mkdirSync(ERRORS_DIR, { recursive: true });
    // Should not throw or try to treat errors/ as a source group.
    await expect(runWatcherOnce()).resolves.toBeUndefined();
  });
});

describe('IPC watcher — task routing', () => {
  it('routes a task file through processTaskIpc using the directory identity', async () => {
    // 'other' schedules a task for itself — allowed.
    writeIpcFile('other', 'tasks', 't1.json', {
      type: 'schedule_task',
      prompt: 'ping',
      schedule_type: 'interval',
      schedule_value: '60000',
      context_mode: 'isolated',
      targetJid: 'other@g.us',
    });

    await runWatcherOnce();

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].group_folder).toBe('other');
  });

  it('quarantines a malformed task file', async () => {
    writeIpcFile('other', 'tasks', 'bad.json', 'not-json-at-all');

    await runWatcherOnce();

    expect(getAllTasks()).toHaveLength(0);
    expect(fs.existsSync(path.join(ERRORS_DIR, 'other-bad.json'))).toBe(true);
  });
});
