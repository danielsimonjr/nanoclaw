import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';

describe('group folder validation', () => {
  it('accepts normal group folder names', () => {
    expect(isValidGroupFolder('main')).toBe(true);
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('../../etc')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('rejects Windows reserved device names (any case)', () => {
    for (const name of [
      'con',
      'CON',
      'nul',
      'aux',
      'prn',
      'com1',
      'COM9',
      'lpt1',
      'lpt9',
    ]) {
      expect(isValidGroupFolder(name), name).toBe(false);
    }
    // Names that merely contain a reserved token are fine.
    expect(isValidGroupFolder('console')).toBe(true);
    expect(isValidGroupFolder('com10')).toBe(true);
    expect(isValidGroupFolder('my-con')).toBe(true);
  });

  it('resolves safe paths under groups directory', () => {
    const resolved = resolveGroupFolderPath('family-chat');
    expect(resolved.endsWith(`${path.sep}groups${path.sep}family-chat`)).toBe(
      true,
    );
  });

  it('resolves safe paths under data ipc directory', () => {
    const resolved = resolveGroupIpcPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}data${path.sep}ipc${path.sep}family-chat`),
    ).toBe(true);
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });
});
