import fs from 'fs';
import path from 'path';

/**
 * Normalize a path to POSIX (forward-slash) separators.
 *
 * Logical paths that are stored in state/manifests, used as map keys, or
 * compared against shipped metadata MUST be platform-independent. `path.relative`
 * and friends emit `\` on Windows, which breaks those lookups and comparisons.
 * Apply this at the point a path becomes a logical identifier rather than a
 * filesystem argument.
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Recursively copy a directory tree from src to dest, creating destination
 * directories as needed.
 *
 * `excludes` is a list of entry names (e.g. 'node_modules', '.git') skipped at
 * every level — used to keep build output, VCS, deps, and runtime data out of
 * base snapshots and tree copies. Matching is by basename, not path.
 */
export function copyDir(
  src: string,
  dest: string,
  excludes: string[] = [],
): void {
  const excludeSet = new Set(excludes);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeSet.has(entry.name)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, excludes);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
