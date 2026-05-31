/**
 * Shared helpers for running Node.js scripts from setup steps in a
 * cross-platform way.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Run a Node.js script given as a source string. The source is written to a
 * temp `.mjs` file and executed with `node <file>`, instead of passing it
 * inline via `node -e "<source>"`. Inline `-e` is fragile on Windows cmd.exe
 * (special chars like `%`, `^`, `&`, nested quotes, and length limits), so the
 * temp-file approach is portable across macOS, Linux, and native Windows.
 *
 * The temp file is written inside the project root (default `cwd`) so that the
 * script's `import`/`require` resolves the project's `node_modules` — Node
 * resolves bare specifiers relative to the script file's location, not `cwd`.
 *
 * Returns the script's stdout. The temp file is always removed.
 */
export function runNodeScript(
  source: string,
  opts: { cwd?: string; timeout?: number } = {},
): string {
  const baseDir = opts.cwd ?? process.cwd();
  const tmpFile = path.join(
    baseDir,
    `.nanoclaw-setup-${process.pid}-${Date.now()}.mjs`,
  );
  fs.writeFileSync(tmpFile, source);
  try {
    return execFileSync(process.execPath, [tmpFile], {
      cwd: opts.cwd,
      timeout: opts.timeout,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* best effort */
    }
  }
}
