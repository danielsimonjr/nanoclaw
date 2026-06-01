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
 * Recursively copy a directory tree from src to dest.
 * Creates destination directories as needed.
 */
export function copyDir(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
