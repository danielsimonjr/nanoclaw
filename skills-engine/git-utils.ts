import { execFileSync } from 'child_process';

/**
 * Run `git diff --no-index` on the given path arguments (resolved relative to
 * `cwd`) and return the unified diff. Returns '' when the inputs are identical.
 *
 * Why git instead of the POSIX `diff` binary: git is already a hard dependency
 * of the skills engine, whereas `diff` is not guaranteed on Windows — it ships
 * with git-bash but may be absent from PATH, so `diff`-based patch generation
 * silently failed there. `git diff --no-index` also emits git-format patches
 * that `git apply` re-applies cleanly during an upstream update.
 *
 * Pass paths relative to `cwd` (forward slashes) so the emitted `a/…`–`b/…`
 * headers strip to project-relative targets under `git apply -p1`. Use the
 * literal `/dev/null` for an added or removed side.
 *
 * `git diff --no-index` exits 1 (with the patch on stdout) when the inputs
 * differ — that is the normal "found differences" path, not a failure. Any
 * other non-zero status is a real error and throws.
 */
export function gitDiffNoIndex(args: string[], cwd: string): string {
  try {
    return execFileSync('git', ['diff', '--no-index', '--', ...args], {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (e.status === 1 && typeof e.stdout === 'string') {
      return e.stdout;
    }
    const detail = e.stderr ? `: ${e.stderr.trim()}` : '';
    throw new Error(
      `git diff --no-index failed (status ${e.status ?? '?'}${detail})`,
    );
  }
}
