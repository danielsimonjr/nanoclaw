import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { hashDir, syncDirIfChanged } from './fs-sync.js';

const ROOT = path.join(os.tmpdir(), 'nanoclaw-fs-sync-test');
const SRC = path.join(ROOT, 'src');
const DEST = path.join(ROOT, 'dest');

function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('hashDir', () => {
  it('changes when file contents change', () => {
    write(SRC, 'a.ts', 'one');
    const h1 = hashDir(SRC);
    write(SRC, 'a.ts', 'two');
    expect(hashDir(SRC)).not.toBe(h1);
  });

  it('changes when files are added', () => {
    write(SRC, 'a.ts', 'one');
    const h1 = hashDir(SRC);
    write(SRC, 'b.ts', 'two');
    expect(hashDir(SRC)).not.toBe(h1);
  });

  it('is stable across calls for identical content', () => {
    write(SRC, 'a.ts', 'one');
    write(SRC, 'nested/b.ts', 'two');
    expect(hashDir(SRC)).toBe(hashDir(SRC));
  });
});

describe('syncDirIfChanged', () => {
  it('copies the source on first sync and writes a hash stamp', () => {
    write(SRC, 'index.ts', 'v1');
    syncDirIfChanged(SRC, DEST);
    expect(fs.readFileSync(path.join(DEST, 'index.ts'), 'utf-8')).toBe('v1');
    expect(fs.existsSync(`${DEST}.hash`)).toBe(true);
  });

  it('refreshes the copy when the source changes (the /update bug fix)', () => {
    write(SRC, 'index.ts', 'v1');
    syncDirIfChanged(SRC, DEST);
    // Upstream changes (e.g. after /update).
    write(SRC, 'index.ts', 'v2');
    write(SRC, 'new-tool.ts', 'added');
    syncDirIfChanged(SRC, DEST);
    expect(fs.readFileSync(path.join(DEST, 'index.ts'), 'utf-8')).toBe('v2');
    expect(fs.existsSync(path.join(DEST, 'new-tool.ts'))).toBe(true);
  });

  it('does not re-copy when the source is unchanged', () => {
    write(SRC, 'index.ts', 'v1');
    syncDirIfChanged(SRC, DEST);
    // Mark the dest so we can detect an unwanted overwrite.
    const marker = path.join(DEST, 'index.ts');
    const before = fs.statSync(marker).mtimeMs;
    syncDirIfChanged(SRC, DEST);
    expect(fs.statSync(marker).mtimeMs).toBe(before);
  });

  it('removes files deleted upstream on refresh', () => {
    write(SRC, 'index.ts', 'v1');
    write(SRC, 'old.ts', 'remove me');
    syncDirIfChanged(SRC, DEST);
    expect(fs.existsSync(path.join(DEST, 'old.ts'))).toBe(true);
    fs.rmSync(path.join(SRC, 'old.ts'));
    syncDirIfChanged(SRC, DEST);
    expect(fs.existsSync(path.join(DEST, 'old.ts'))).toBe(false);
  });

  it('is a no-op when the source does not exist', () => {
    expect(() =>
      syncDirIfChanged(path.join(ROOT, 'missing'), DEST),
    ).not.toThrow();
    expect(fs.existsSync(DEST)).toBe(false);
  });
});
