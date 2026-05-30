/**
 * Content-aware directory sync helpers.
 *
 * Used to keep per-group copies (e.g. the agent-runner source) up to date with
 * an upstream directory, refreshing only when the content actually changed.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/** Recursively collect file paths under a directory, sorted for stable hashing. */
function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

/** Content hash of a directory tree (relative paths + file contents). */
export function hashDir(dir: string): string {
  const hash = crypto.createHash('sha256');
  for (const file of listFilesRecursive(dir)) {
    hash.update(path.relative(dir, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Copy `srcDir` to `destDir`, refreshing only when the source content has
 * changed since the last sync (tracked via a sibling `.hash` stamp). This keeps
 * per-group copies up to date after upstream changes without clobbering on
 * every run. No-op if `srcDir` does not exist.
 */
export function syncDirIfChanged(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  const stampFile = `${destDir}.hash`;
  const srcHash = hashDir(srcDir);
  const prevHash = fs.existsSync(stampFile)
    ? fs.readFileSync(stampFile, 'utf-8').trim()
    : '';
  if (prevHash === srcHash && fs.existsSync(destDir)) return;
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
  fs.writeFileSync(stampFile, srcHash);
}
