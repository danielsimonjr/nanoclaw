import fs from 'fs';
import path from 'path';

import { BASE_DIR, CUSTOM_DIR, NANOCLAW_DIR } from './constants.js';
import { gitDiffNoIndex } from './git-utils.js';
import { initNanoclawDir } from './init.js';
import { recordCustomModification } from './state.js';

export function initSkillsSystem(): void {
  initNanoclawDir();
  console.log('Skills system initialized. .nanoclaw/ directory created.');
}

export function migrateExisting(): void {
  const projectRoot = process.cwd();

  // First, do a fresh init
  initNanoclawDir();

  // Then, diff current files against base to capture modifications.
  const customDir = path.join(projectRoot, CUSTOM_DIR);
  const patchRelPath = path.join(CUSTOM_DIR, 'migration.patch');

  try {
    // Paths relative to projectRoot so the patch carries project-relative
    // a/…–b/… headers (see git-utils.ts for why git rather than `diff`).
    const diff = gitDiffNoIndex([`${BASE_DIR}/src`, 'src'], projectRoot);

    if (diff.trim()) {
      fs.mkdirSync(customDir, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, patchRelPath), diff, 'utf-8');

      // Extract modified file paths from the git diff headers (b/<path>),
      // which are already project-relative and POSIX.
      const filesModified = [...diff.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)]
        .map((m) => m[1])
        .filter((f) => !f.startsWith('.nanoclaw'));

      // Record in state so the patch is visible to the tracking system
      recordCustomModification(
        'Pre-skills migration',
        filesModified,
        patchRelPath,
      );

      console.log(
        'Custom modifications captured in .nanoclaw/custom/migration.patch',
      );
    } else {
      console.log('No custom modifications detected.');
    }
  } catch {
    console.log('Could not generate diff. Continuing with clean base.');
  }

  console.log('Migration complete. Skills system ready.');
}
