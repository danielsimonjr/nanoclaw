import fs from 'fs';
import path from 'path';

import { BACKUP_DIR } from './constants.js';

const TOMBSTONE_SUFFIX = '.tombstone';

function getBackupDir(): string {
  return path.join(process.cwd(), BACKUP_DIR);
}

export function createBackup(filePaths: string[]): void {
  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });
  for (const filePath of filePaths) {
    backupOne(path.resolve(filePath), backupDir);
  }
}

function backupOne(absPath: string, backupDir: string): void {
  const backupPath = path.join(
    backupDir,
    path.relative(process.cwd(), absPath),
  );

  if (!fs.existsSync(absPath)) {
    // Doesn't exist yet — write a tombstone so restore deletes it on abort.
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath + TOMBSTONE_SUFFIX, '', 'utf-8');
    return;
  }

  if (fs.statSync(absPath).isDirectory()) {
    // Recurse: copyFileSync would throw EISDIR on a directory source (e.g. a
    // file_op that renames/moves a directory), aborting the whole backup.
    for (const entry of fs.readdirSync(absPath)) {
      backupOne(path.join(absPath, entry), backupDir);
    }
    return;
  }

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(absPath, backupPath);
}

export function restoreBackup(): void {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(TOMBSTONE_SUFFIX)) {
        // Tombstone: delete the corresponding project file
        const tombRelPath = path.relative(backupDir, fullPath);
        const originalRelPath = tombRelPath.slice(0, -TOMBSTONE_SUFFIX.length);
        const originalPath = path.join(process.cwd(), originalRelPath);
        // rmSync (recursive+force) handles both files and directories and is a
        // no-op if already gone — unlinkSync would throw on a directory.
        fs.rmSync(originalPath, { recursive: true, force: true });
      } else {
        const relativePath = path.relative(backupDir, fullPath);
        const originalPath = path.join(process.cwd(), relativePath);
        fs.mkdirSync(path.dirname(originalPath), { recursive: true });
        fs.copyFileSync(fullPath, originalPath);
      }
    }
  };

  walk(backupDir);
}

export function clearBackup(): void {
  const backupDir = getBackupDir();
  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}
