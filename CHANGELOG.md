# Changelog

All notable changes to this fork of NanoClaw are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project
does not strictly follow semantic versioning (it is a personal fork).

## [Unreleased]

### Security (2026-08-04)

Lock-only via `npm update`; no manifest changed. Transitive dependencies of the
MCP SDK / server stack:

- `ip-address` -> 10.4.0 (1 high + 2 medium; needed 10.3.1)
- `hono` -> 4.13.0 (medium; needed 4.12.34)
- `fast-uri` -> 3.1.5 (high; needed 3.1.5)

Only the packages present in this repo's tree are listed above by the resolver;
`npm audit` reports 0 vulnerabilities. Verified with `npm ci` plus this repo's
own build and test scripts.


### Security — all 7 open Dependabot alerts resolved, lock-only (2026-08-03)

Every fix landed inside the existing semver ranges, so no manifest changed.

Root `package-lock.json`:

- `postcss` 8.5.15 -> 8.5.25 (high, GHSA needs 8.5.18) — via `vite ^8.5.15`
- `sharp` 0.34.5 -> 0.35.3 (high, needs 0.35.0), with all 25 `@img/*`
  platform binaries and libvips 1.2.4 -> 1.3.2
- `protobufjs` 7.6.4 -> 7.6.5 (medium) — via `@whiskeysockets/baileys`

`container/agent-runner/package-lock.json`:

- `fast-uri` 3.1.2 -> 3.1.5 (two high alerts, needs 3.1.3 and 3.1.4)
- `body-parser` 2.2.2 -> 2.3.0 (low)
- `@hono/node-server` 1.19.14 -> 2.0.12 (medium, needs 2.0.5)

The hono fix needed an indirection: `@modelcontextprotocol/sdk` pinned
`@hono/node-server` to `^1.19.9`, so no in-range update could reach 2.x.
SDK 1.30.0 widened that to `^1.19.9 || ^2.0.5` and is itself inside the
existing `^1.12.1` range, so updating the SDK 1.26.0 -> 1.30.0 unlocked the
hono major without a manifest edit.

Verified: `npm audit` reports 0 vulnerabilities in both projects;
`npm run typecheck` and `npm run build` pass at the root; `npm ci` +
`tsc` pass in `container/agent-runner` (the exact commands `build:agent`
runs) on hono 2.x; and `sharp` 0.35.3 loads reporting libvips 8.18.3.

Not verified locally: 92 of 476 vitest cases could not execute on this
machine. All 92 fail with a single cause — `better-sqlite3` 11.10.0 ships
no prebuilt binary for Node 24 (ABI v137), and node-gyp cannot find a
usable MSVC toolchain here, so the addon is absent. `better-sqlite3` is
untouched by this change and CI runs Node 20, where the prebuild exists.
The other 384 cases pass.


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
