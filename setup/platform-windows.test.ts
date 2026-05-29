import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate a native Windows host. os.platform() drives all branching.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: { ...actual, platform: () => 'win32' },
    platform: () => 'win32',
  };
});

const exec = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('child_process', () => ({ execSync: exec.fn }));

import {
  getPlatform,
  isWindows,
  isWSL,
  isHeadless,
  hasSystemd,
  getServiceManager,
  commandExists,
  getNodePath,
  openBrowser,
} from './platform.js';

beforeEach(() => {
  exec.fn.mockReset();
});

describe('platform detection on Windows', () => {
  it('reports the windows platform', () => {
    expect(getPlatform()).toBe('windows');
    expect(isWindows()).toBe(true);
  });

  it('selects the schtasks service manager', () => {
    expect(getServiceManager()).toBe('schtasks');
  });

  it('is never WSL or systemd on native Windows', () => {
    expect(isWSL()).toBe(false);
    expect(hasSystemd()).toBe(false);
  });

  it('is not headless', () => {
    expect(isHeadless()).toBe(false);
  });
});

describe('command utilities on Windows', () => {
  it('probes commands with `where`', () => {
    exec.fn.mockReturnValue('');
    expect(commandExists('docker')).toBe(true);
    expect(exec.fn).toHaveBeenCalledWith('where docker', expect.anything());
  });

  it('returns false when `where` throws', () => {
    exec.fn.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(commandExists('nope')).toBe(false);
  });

  it('resolves the node path from the first `where node` line', () => {
    exec.fn.mockReturnValue(
      'C:\\Program Files\\nodejs\\node.exe\r\nC:\\other\\node.exe',
    );
    expect(getNodePath()).toBe('C:\\Program Files\\nodejs\\node.exe');
    expect(exec.fn).toHaveBeenCalledWith('where node', expect.anything());
  });

  it('opens a URL via the cmd `start` builtin with an empty title', () => {
    exec.fn.mockReturnValue('');
    expect(openBrowser('https://example.com')).toBe(true);
    const cmd = exec.fn.mock.calls[0][0] as string;
    expect(cmd).toContain('start ""');
    expect(cmd).toContain('https://example.com');
  });
});
