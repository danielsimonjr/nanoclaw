import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Deterministic temp location shared between the (hoisted) config mock and the
// tests themselves. Real directories are created here so that symlink
// resolution is exercised against the actual filesystem.
const h = vi.hoisted(() => {
  const os = require('os') as typeof import('os');
  const path = require('path') as typeof import('path');
  const TEST_DIR = path.join(os.tmpdir(), 'nanoclaw-mount-security-test');
  return {
    TEST_DIR,
    ALLOWLIST_PATH: path.join(TEST_DIR, 'mount-allowlist.json'),
  };
});

vi.mock('./config.js', () => ({
  MOUNT_ALLOWLIST_PATH: h.ALLOWLIST_PATH,
}));

// Silence pino output during tests.
vi.mock('pino', () => {
  const noop = () => {};
  const fn = () => ({ info: noop, warn: noop, error: noop, debug: noop });
  return { default: fn };
});

import {
  loadMountAllowlist,
  validateMount,
  validateAdditionalMounts,
  generateAllowlistTemplate,
  hostPathHasDisallowedColon,
  _resetMountAllowlistCache,
} from './mount-security.js';
import { MountAllowlist } from './types.js';

const TEST_DIR = h.TEST_DIR;
const ALLOWLIST_PATH = h.ALLOWLIST_PATH;
const ALLOWED_RW = path.join(TEST_DIR, 'allowed-rw');
const ALLOWED_RO = path.join(TEST_DIR, 'allowed-ro');
const OUTSIDE = path.join(TEST_DIR, 'outside');

function writeAllowlist(partial: Partial<MountAllowlist>): void {
  const allowlist: MountAllowlist = {
    allowedRoots: [
      { path: ALLOWED_RW, allowReadWrite: true, description: 'rw root' },
      { path: ALLOWED_RO, allowReadWrite: false, description: 'ro root' },
    ],
    blockedPatterns: [],
    nonMainReadOnly: true,
    ...partial,
  };
  fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(allowlist));
}

function resetTree(): void {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(ALLOWED_RW, { recursive: true });
  fs.mkdirSync(ALLOWED_RO, { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
}

beforeEach(() => {
  resetTree();
  _resetMountAllowlistCache();
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('loadMountAllowlist', () => {
  it('returns null when the allowlist file does not exist', () => {
    expect(loadMountAllowlist()).toBeNull();
  });

  it('returns null and caches the failure on invalid JSON', () => {
    fs.writeFileSync(ALLOWLIST_PATH, '{ not valid json');
    expect(loadMountAllowlist()).toBeNull();
    // Even after a valid file appears, the cached error suppresses re-reads.
    writeAllowlist({});
    expect(loadMountAllowlist()).toBeNull();
  });

  it('rejects an allowlist whose allowedRoots is not an array', () => {
    fs.writeFileSync(
      ALLOWLIST_PATH,
      JSON.stringify({
        allowedRoots: {},
        blockedPatterns: [],
        nonMainReadOnly: true,
      }),
    );
    expect(loadMountAllowlist()).toBeNull();
  });

  it('rejects an allowlist whose nonMainReadOnly is not a boolean', () => {
    fs.writeFileSync(
      ALLOWLIST_PATH,
      JSON.stringify({
        allowedRoots: [],
        blockedPatterns: [],
        nonMainReadOnly: 'yes',
      }),
    );
    expect(loadMountAllowlist()).toBeNull();
  });

  it('merges the default blocked patterns with user-provided ones', () => {
    writeAllowlist({ blockedPatterns: ['custom-secret'] });
    const allowlist = loadMountAllowlist();
    expect(allowlist).not.toBeNull();
    expect(allowlist!.blockedPatterns).toContain('custom-secret');
    expect(allowlist!.blockedPatterns).toContain('.ssh');
    expect(allowlist!.blockedPatterns).toContain('id_rsa');
  });

  it('caches the loaded allowlist across calls', () => {
    writeAllowlist({});
    const first = loadMountAllowlist();
    fs.rmSync(ALLOWLIST_PATH); // file gone, but cache should persist
    const second = loadMountAllowlist();
    expect(second).toBe(first);
  });
});

describe('validateMount — allowlist gating', () => {
  it('blocks all mounts when no allowlist is configured', () => {
    const result = validateMount({ hostPath: ALLOWED_RW }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allowlist/i);
  });

  it('allows a path under an allowed root', () => {
    writeAllowlist({});
    const target = path.join(ALLOWED_RW, 'data');
    fs.mkdirSync(target);
    const result = validateMount({ hostPath: target }, true);
    expect(result.allowed).toBe(true);
    expect(result.realHostPath).toBe(fs.realpathSync(target));
    expect(result.resolvedContainerPath).toBe('data');
  });

  it('rejects a path not under any allowed root', () => {
    writeAllowlist({});
    const result = validateMount({ hostPath: OUTSIDE }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not under any allowed root/i);
  });

  it('rejects a host path that does not exist', () => {
    writeAllowlist({});
    const result = validateMount(
      { hostPath: path.join(ALLOWED_RW, 'does-not-exist') },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/does not exist/i);
  });
});

describe('validateMount — blocked patterns', () => {
  it('blocks a sensitive directory even under an allowed root', () => {
    writeAllowlist({});
    const ssh = path.join(ALLOWED_RW, '.ssh');
    fs.mkdirSync(ssh);
    const result = validateMount({ hostPath: ssh }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/blocked pattern/i);
  });

  it('blocks case-variant sensitive names (case-insensitive matching)', () => {
    writeAllowlist({});
    // Upper-case `.SSH` and `Credentials` map to the same secrets on
    // case-insensitive filesystems and must be blocked.
    const upperSsh = path.join(ALLOWED_RW, '.SSH');
    const creds = path.join(ALLOWED_RW, 'Credentials');
    fs.mkdirSync(upperSsh);
    fs.mkdirSync(creds);
    expect(validateMount({ hostPath: upperSsh }, true).allowed).toBe(false);
    expect(validateMount({ hostPath: creds }, true).allowed).toBe(false);
  });
});

describe('validateMount — container path validation', () => {
  beforeEach(() => writeAllowlist({}));

  it('rejects a container path containing ".."', () => {
    const result = validateMount(
      { hostPath: ALLOWED_RW, containerPath: '../escape' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/container path/i);
  });

  it('rejects an absolute container path', () => {
    const result = validateMount(
      { hostPath: ALLOWED_RW, containerPath: '/etc/passwd' },
      true,
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects a container path containing ":" (mount-option injection)', () => {
    // `/workspace/extra/foo:rw` would inject a writable mode override.
    const result = validateMount(
      { hostPath: ALLOWED_RW, containerPath: 'foo:rw' },
      true,
    );
    expect(result.allowed).toBe(false);
  });

  it('rejects a container path containing a null byte', () => {
    const result = validateMount(
      { hostPath: ALLOWED_RW, containerPath: 'foo\x00bar' },
      true,
    );
    expect(result.allowed).toBe(false);
  });

  it('defaults the container path to the basename of the host path', () => {
    const target = path.join(ALLOWED_RW, 'project');
    fs.mkdirSync(target);
    const result = validateMount({ hostPath: target }, true);
    expect(result.allowed).toBe(true);
    expect(result.resolvedContainerPath).toBe('project');
  });
});

describe('validateMount — malformed host path (no throw)', () => {
  beforeEach(() => writeAllowlist({}));

  it('rejects an undefined host path without throwing', () => {
    const result = validateMount(
      { hostPath: undefined as unknown as string },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/host path/i);
  });

  it('rejects an empty host path', () => {
    expect(validateMount({ hostPath: '   ' }, true).allowed).toBe(false);
  });

  it('rejects a host path containing ":" or control characters', () => {
    expect(validateMount({ hostPath: '/tmp/a:b' }, true).allowed).toBe(false);
    expect(validateMount({ hostPath: '/tmp/a\x00b' }, true).allowed).toBe(
      false,
    );
  });
});

describe('validateMount — symlink escape', () => {
  beforeEach(() => writeAllowlist({}));

  it('rejects a symlink inside an allowed root that points outside it', () => {
    const link = path.join(ALLOWED_RW, 'escape-link');
    fs.symlinkSync(OUTSIDE, link);
    const result = validateMount({ hostPath: link }, true);
    // The real (resolved) path is OUTSIDE, which is not under any allowed root.
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not under any allowed root/i);
  });

  it('allows a symlink that resolves to a location inside an allowed root', () => {
    const realTarget = path.join(ALLOWED_RW, 'real-data');
    fs.mkdirSync(realTarget);
    const link = path.join(TEST_DIR, 'link-into-allowed');
    fs.symlinkSync(realTarget, link);
    const result = validateMount({ hostPath: link }, true);
    expect(result.allowed).toBe(true);
    expect(result.realHostPath).toBe(fs.realpathSync(realTarget));
  });
});

describe('validateMount — read/write downgrade logic', () => {
  it('grants read-write on a read-write root for the main group', () => {
    writeAllowlist({});
    const result = validateMount(
      { hostPath: ALLOWED_RW, readonly: false },
      true,
    );
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(false);
  });

  it('forces read-only when the root does not allow read-write', () => {
    writeAllowlist({});
    const result = validateMount(
      { hostPath: ALLOWED_RO, readonly: false },
      true,
    );
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('forces read-only for non-main groups when nonMainReadOnly is set', () => {
    writeAllowlist({ nonMainReadOnly: true });
    const result = validateMount(
      { hostPath: ALLOWED_RW, readonly: false },
      false, // non-main
    );
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('allows read-write for non-main groups when nonMainReadOnly is false', () => {
    writeAllowlist({ nonMainReadOnly: false });
    const result = validateMount(
      { hostPath: ALLOWED_RW, readonly: false },
      false,
    );
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(false);
  });

  it('defaults to read-only when read-write is not requested', () => {
    writeAllowlist({});
    const result = validateMount({ hostPath: ALLOWED_RW }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });
});

describe('validateAdditionalMounts', () => {
  beforeEach(() => writeAllowlist({}));

  it('returns only validated mounts, prefixed with /workspace/extra/', () => {
    const good = path.join(ALLOWED_RW, 'good');
    fs.mkdirSync(good);
    const mounts = validateAdditionalMounts(
      [
        { hostPath: good },
        { hostPath: OUTSIDE }, // rejected: not under allowed root
        { hostPath: path.join(ALLOWED_RW, '.ssh') }, // rejected: missing + blocked
      ],
      'test-group',
      true,
    );
    expect(mounts).toHaveLength(1);
    expect(mounts[0].containerPath).toBe('/workspace/extra/good');
    expect(mounts[0].hostPath).toBe(fs.realpathSync(good));
    expect(mounts[0].readonly).toBe(true);
  });

  it('returns an empty array when every mount is rejected', () => {
    const mounts = validateAdditionalMounts(
      [{ hostPath: OUTSIDE }],
      'test-group',
      true,
    );
    expect(mounts).toEqual([]);
  });
});

describe('generateAllowlistTemplate', () => {
  it('produces valid JSON shaped like a MountAllowlist', () => {
    const parsed = JSON.parse(generateAllowlistTemplate()) as MountAllowlist;
    expect(Array.isArray(parsed.allowedRoots)).toBe(true);
    expect(Array.isArray(parsed.blockedPatterns)).toBe(true);
    expect(typeof parsed.nonMainReadOnly).toBe('boolean');
    expect(parsed.allowedRoots[0]).toHaveProperty('path');
    expect(parsed.allowedRoots[0]).toHaveProperty('allowReadWrite');
  });
});

describe('hostPathHasDisallowedColon', () => {
  it('rejects any colon on POSIX platforms', () => {
    expect(hostPathHasDisallowedColon('/home/me/a:b', 'linux')).toBe(true);
    expect(hostPathHasDisallowedColon('/home/me/data', 'linux')).toBe(false);
  });

  it('permits a single leading drive-letter colon on Windows', () => {
    expect(hostPathHasDisallowedColon('C:\\Users\\me\\data', 'win32')).toBe(
      false,
    );
    expect(hostPathHasDisallowedColon('d:\\projects', 'win32')).toBe(false);
  });

  it('still rejects extra colons on Windows (e.g. NTFS data streams)', () => {
    // A drive colon plus a stream colon must be blocked.
    expect(
      hostPathHasDisallowedColon('C:\\Users\\me\\file:stream', 'win32'),
    ).toBe(true);
    // A colon that is not a drive letter (two chars before it) is blocked.
    expect(hostPathHasDisallowedColon('ab:\\evil', 'win32')).toBe(true);
  });
});
