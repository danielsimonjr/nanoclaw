# TODO

**Status (2026-06-01): development paused.** All gates green — `npm run typecheck`,
`npm run format:check`, `npm run build`, `npm test` (476/476), the skills suite
(28/28), and `npm run build:agent` / `npm run typecheck:agent` all pass on
Windows 10/11. 0 circular dependencies, 0 npm-audit vulnerabilities. See
[CHANGELOG.md](CHANGELOG.md) for what landed.

There is no committed work in progress. The items below were considered during
the hardening pass and **deliberately deferred** (each is a design trade-off,
an environmental artifact, or low value); they are recorded so they aren't
re-discovered as "new."

## Deferred by design (changing them is net-negative)

- **`src/index.ts` `outputSentToUser`** — after the agent sends partial output
  then errors, the cursor is left advanced (no rollback) to avoid re-sending
  earlier replies. Rolling back would reprocess the whole batch and duplicate
  messages. Correct trade-off.
- **Loop-crash container orphaning** — on an orchestrator crash, containers are
  left running on purpose (they survive restarts, are recovered by
  `cleanupOrphans` on next start, and self-terminate at `CONTAINER_TIMEOUT`).
  Reaping them on crash would lose recoverable work.

## Deferred — non-bugs in practice / low value

- **git `cwd: projectRoot` threading** — the skills-engine assumes
  `process.cwd() === projectRoot` (true for every entry point). Threading
  `projectRoot` through every git call + `merge.ts` is a large refactor; a
  partial fix would be worse (inconsistent cwd between calls). Leave consistent.
- **`skills-engine/lock.ts` PID-reuse** — a stale lock whose PID was recycled
  within the 5-min window is treated as held. Rare; a clean fix needs real
  process identity. Low priority.
- **Test coverage 60.7% (37/61 files)** — most untested files are `setup/` CLI
  steps, `scripts/`, and the `container/agent-runner/` package, which are
  exercised via the `/setup` and skill workflows rather than unit tests. Add
  unit tests here if coverage becomes a goal. (`docs/architecture/TEST_COVERAGE.md`)
- **11 "potentially unused exports"** (`docs/architecture/unused-analysis.md`) —
  public types + one internal helper (`readAllManifests` in
  `scripts/generate-ci-matrix.ts`). Informational, not dead code.

## Not a code defect (environmental)

- **path-remap `realpathSync` flake** — under heavy parallel test load on
  Windows, `fs.realpathSync` on a freshly-created temp dir can transiently fail
  (Defender). CI-safe (does not reproduce on Linux); no honest code fix.

## Maintenance notes

- Regenerate the architecture/coverage reports after structural changes:
  `npx tsx tools/create-dependency-graph/create-dependency-graph.ts --include-tests`
  (needs `js-yaml` in the tool's `node_modules`: `npm install` in
  `tools/create-dependency-graph/`).
- If `npm run build:agent` ever dirties the tree again, a stale
  `container/agent-runner/node_modules/nanoclaw` symlink is back — `npm ci`
  (which the script now uses) clears it.
