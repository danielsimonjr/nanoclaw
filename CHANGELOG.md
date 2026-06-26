# Changelog

All notable changes to this fork of NanoClaw are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
does not strictly follow semantic versioning (it is a personal fork).

## [Unreleased]

A Windows 10/11 compatibility + stability hardening pass. The full test suite is
476 tests across 44 files (0 circular dependencies; 1 low-severity dev-only
npm-audit advisory remaining — the `esbuild` dev-server file-read issue, which
this project does not use); the dependency tool now maps all first-party source.

### Security

- **Patched the moderate `protobufjs` advisory** (GHSA-f38q-mgvj-vph7 — schema
  -derived names shadowing runtime-significant properties), a transitive
  dependency via `@whiskeysockets/baileys`, by bumping it to 7.6.4 through
  `npm audit fix` (lockfile-only). Typecheck and all 476 tests still pass. The
  remaining `esbuild` advisory is dev-server-only and not applicable here.

### Added

- CI (`.github/workflows/test.yml`): a Linux `engine` job that runs the full
  `skills-engine` suite (previously run in no workflow), an `agent-runner` build
  job, a `format:check` gate, and Node 24 to the test matrix.
- `skills-engine/git-utils.ts` — shared `gitDiffNoIndex()` helper.
- `UpdateResult.deletionConflicts` — surfaces upstream-deleted files that an
  applied skill still modifies (instead of silently deleting them).
- `db.buildMessageCursor()` and a `(timestamp, id)` keyset message cursor.
- `tools/create-dependency-graph` now maps **all** first-party source
  (`src/`, `setup/`, `skills-engine/`, `scripts/`, `container/agent-runner/src/`),
  parses dynamic imports, recognizes entry points, and is test-aware. New
  `--exclude`/`--also-exclude` flags.

### Fixed

- **Same-second message loss**: the message cursor was a bare second-resolution
  timestamp (`timestamp > ?`), dropping a second message that arrived in the same
  second. Replaced with a `(timestamp, id)` keyset cursor.
- **Scheduler retry-storm**: a corrupt cron/interval value threw out of the run
  loop, leaving `next_run` stale and re-enqueuing the task every poll forever.
  Bad schedules now pause the task; failed one-shot tasks are preserved.
- **skills-engine correctness**: `copyDir` now honors its excludes (base
  snapshots no longer pull in `node_modules`/`.git`); an aborted apply fully
  reverses (file-op `from`/`to`/`path` all backed up; `createBackup` handles
  directories); `cleanupMergeState` no longer runs a tree-wide `git reset`;
  `readState` validates the state file; a missing skill modify-source is reported
  as a package error, not a phantom merge conflict.
- **Orchestrator hardening**: the container stdout parse buffer is bounded (a
  buggy/compromised agent can no longer OOM the host); failed IPC files are
  quarantined without throwing (Windows rename-collision safe); the WhatsApp
  client tears down the old socket on reconnect (no socket/listener leak or
  duplicate delivery).
- **Windows portability**: project-relative paths normalized to POSIX
  separators; tsx CLIs spawned via `node --import` (not the `.bin` launcher,
  which fails on Windows); `customize`/`migrate`/`rebase` generate patches with
  `git diff --no-index` instead of the POSIX `diff` binary; `fetch-upstream.sh`
  emits a native temp path via `cygpath`; subprocess-heavy tests given longer
  timeouts; cross-platform test fixes.
- `npm run build:agent` uses `npm ci` so it no longer dirties the working tree.

### Security

- `npm audit fix`: resolved a critical `vitest` advisory (root) and 8 transitive
  advisories in `container/agent-runner` (hono, path-to-regexp, qs, ip-address).
  0 vulnerabilities remain.

### Documentation

- `README.md`, `docs/architecture/*`, and `CLAUDE.md` synced to the dependency
  graph (real 7-module layout, entry points, current test/coverage stats, and
  the updated `db`/`skills-engine` APIs).
