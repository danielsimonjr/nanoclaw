import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

import { copyDir } from '../fs-utils.js';
import { cleanup, createTempDir } from './test-helpers.js';

describe('copyDir', () => {
  let tmpDir: string;
  let src: string;
  let dest: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    src = path.join(tmpDir, 'src');
    dest = path.join(tmpDir, 'dest');
    fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(src, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(src, 'sub', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.ts'), 'a');
    fs.writeFileSync(path.join(src, 'sub', 'b.ts'), 'b');
    fs.writeFileSync(path.join(src, 'node_modules', 'pkg', 'x.js'), 'x');
    fs.writeFileSync(path.join(src, 'sub', 'node_modules', 'y.js'), 'y');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('copies the full tree when no excludes are given', () => {
    copyDir(src, dest);
    expect(fs.existsSync(path.join(dest, 'a.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'sub', 'b.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'node_modules', 'pkg', 'x.js'))).toBe(
      true,
    );
  });

  it('skips excluded entry names at every depth', () => {
    copyDir(src, dest, ['node_modules']);
    expect(fs.existsSync(path.join(dest, 'a.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'sub', 'b.ts'))).toBe(true);
    // Excluded at top level...
    expect(fs.existsSync(path.join(dest, 'node_modules'))).toBe(false);
    // ...and nested.
    expect(fs.existsSync(path.join(dest, 'sub', 'node_modules'))).toBe(false);
  });
});
