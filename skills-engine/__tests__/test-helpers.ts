import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { stringify } from 'yaml';

export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-test-'));
}

// Absolute file URL of tsx's ESM loader, resolved once from this module's
// location. Passed to `node --import` so the loader is found regardless of the
// spawned process's cwd (test scripts run with cwd set to a throwaway temp dir
// that has no node_modules).
const tsxLoaderUrl = pathToFileURL(
  createRequire(import.meta.url).resolve('tsx'),
).href;

/**
 * Run a TypeScript CLI script through tsx and return its stdout.
 *
 * Spawns `node --import <tsx-loader> <args...>` rather than the
 * `node_modules/.bin/tsx` launcher: on Windows that launcher is `tsx.cmd`, and
 * `execFileSync` refuses to run `.cmd`/`.bat` files directly (EINVAL since the
 * CVE-2024-27980 fix), while the extension-less `tsx` shim is an unrunnable
 * POSIX script (ENOENT). Going through the node executable sidesteps both and
 * behaves identically on every platform. On a non-zero exit this throws the
 * standard execFileSync error (carrying `.status`, `.stdout`, and `.stderr`),
 * so callers can assert on it.
 */
export function runTsxScript(
  args: string[],
  options: { cwd: string; timeout?: number },
): string {
  return execFileSync(process.execPath, ['--import', tsxLoaderUrl, ...args], {
    cwd: options.cwd,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: options.timeout ?? 30_000,
  });
}

export function setupNanoclawDir(tmpDir: string): void {
  fs.mkdirSync(path.join(tmpDir, '.nanoclaw', 'base', 'src'), {
    recursive: true,
  });
  fs.mkdirSync(path.join(tmpDir, '.nanoclaw', 'backup'), { recursive: true });
}

export function writeState(tmpDir: string, state: any): void {
  const statePath = path.join(tmpDir, '.nanoclaw', 'state.yaml');
  fs.writeFileSync(statePath, stringify(state), 'utf-8');
}

export function createMinimalState(tmpDir: string): void {
  writeState(tmpDir, {
    skills_system_version: '0.1.0',
    core_version: '1.0.0',
    applied_skills: [],
  });
}

export function createSkillPackage(
  tmpDir: string,
  opts: {
    skill?: string;
    version?: string;
    core_version?: string;
    adds?: string[];
    modifies?: string[];
    addFiles?: Record<string, string>;
    modifyFiles?: Record<string, string>;
    conflicts?: string[];
    depends?: string[];
    test?: string;
    structured?: any;
    file_ops?: any[];
    post_apply?: string[];
    min_skills_system_version?: string;
    dirName?: string;
  },
): string {
  const skillDir = path.join(tmpDir, opts.dirName ?? 'skill-pkg');
  fs.mkdirSync(skillDir, { recursive: true });

  const manifest: Record<string, unknown> = {
    skill: opts.skill ?? 'test-skill',
    version: opts.version ?? '1.0.0',
    description: 'Test skill',
    core_version: opts.core_version ?? '1.0.0',
    adds: opts.adds ?? [],
    modifies: opts.modifies ?? [],
    conflicts: opts.conflicts ?? [],
    depends: opts.depends ?? [],
    test: opts.test,
    structured: opts.structured,
    file_ops: opts.file_ops,
  };
  if (opts.post_apply) manifest.post_apply = opts.post_apply;
  if (opts.min_skills_system_version)
    manifest.min_skills_system_version = opts.min_skills_system_version;

  fs.writeFileSync(path.join(skillDir, 'manifest.yaml'), stringify(manifest));

  if (opts.addFiles) {
    const addDir = path.join(skillDir, 'add');
    for (const [relPath, content] of Object.entries(opts.addFiles)) {
      const fullPath = path.join(addDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }

  if (opts.modifyFiles) {
    const modDir = path.join(skillDir, 'modify');
    for (const [relPath, content] of Object.entries(opts.modifyFiles)) {
      const fullPath = path.join(modDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }

  return skillDir;
}

export function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  execSync('git config rerere.enabled true', { cwd: dir, stdio: 'pipe' });
  // Keep fixtures hermetic: never inherit a developer/CI commit-signing setup,
  // which would otherwise make these throwaway commits fail.
  execSync('git config commit.gpgsign false', { cwd: dir, stdio: 'pipe' });
  execSync('git config tag.gpgsign false', { cwd: dir, stdio: 'pipe' });
  // Pin LF so patch round-trips are deterministic regardless of the host's
  // global core.autocrlf (true on many Windows installs).
  execSync('git config core.autocrlf false', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
}

export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
