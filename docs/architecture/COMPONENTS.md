# NanoClaw — Component Reference

**Version**: 1.1.0
**Last Updated**: 2026-06-01

One section per significant component: its responsibility, key exports,
collaborators (imports / importers, from the dependency graph), and notes. For
exact signatures see [API.md](./API.md); for the raw import matrix see
[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md).

> **Scope.** The full codebase is **61 first-party TypeScript files across 7
> modules** (240 exports, 0 circular dependencies): `src/` (16) and
> `src/channels/` (1) — the orchestrator runtime, covered in depth below; plus
> `skills-engine/` (22), `setup/` (12), `scripts/` (6),
> `container/agent-runner/src/` (2), and 2 root config files. The non-`src/`
> modules run in separate processes/contexts (CLI tooling, the install wizard,
> the in-container agent) and are summarized in
> [Auxiliary Modules](#auxiliary-modules) at the end.

---

## Table of Contents

1. [Overview](#overview)
2. [Entry / Orchestration](#entry--orchestration)
   - [index](#index)
3. [Channels](#channels)
   - [channels/whatsapp](#channelswhatsapp)
4. [Execution](#execution)
   - [container-runner](#container-runner)
   - [container-runtime](#container-runtime)
   - [group-queue](#group-queue)
   - [task-scheduler](#task-scheduler)
5. [Messaging & IPC](#messaging--ipc)
   - [ipc](#ipc)
   - [router](#router)
6. [Persistence & State](#persistence--state)
   - [db](#db)
7. [Security & Paths](#security--paths)
   - [mount-security](#mount-security)
   - [group-folder](#group-folder)
8. [Foundations](#foundations)
   - [config](#config)
   - [env](#env)
   - [fs-sync](#fs-sync)
   - [logger](#logger)
   - [types](#types)
9. [Component Dependencies](#component-dependencies)
10. [Auxiliary Modules](#auxiliary-modules)
    - [skills-engine](#skills-engine)
    - [setup](#setup)
    - [scripts](#scripts)
    - [container/agent-runner](#containeragent-runner)

---

## Overview

NanoClaw is a single Node.js orchestrator process. It connects to messaging
channels (WhatsApp today), persists chat/task/group state in SQLite, and routes
triggered messages and scheduled tasks to a Claude Agent SDK runner that
executes inside an isolated container (or directly on the host in `host` mode).
Each registered group has an isolated filesystem, Claude session, memory, and
IPC namespace.

```
 messaging channel (WhatsApp)
        │  inbound msg / metadata
        ▼
   index.ts  ── GroupQueue (per-group serialization, concurrency cap)
        │            │
        │            ▼
        │     container-runner ── container-runtime (docker/podman/host)
        │            │                 mount-security (additional mounts)
        │            │                 group-folder / fs-sync
        │            ▼
        │       agent (container)  ⇄  IPC files  ⇄  ipc.ts watcher
        │                                              │
        ├── task-scheduler (due tasks) ────────────────┘
        ▼
       db.ts (SQLite: chats, messages, tasks, sessions, groups, router_state)
```

Layering is acyclic (no circular dependencies). `logger` and `config` are the
most-imported leaves; `index` is the top of the graph (imports 12 modules,
exported to none).

---

## Entry / Orchestration

### index

**File**: `src/index.ts` · **Module**: entry

**Responsibility**: Process entry point and orchestrator. Holds the in-memory
state (`lastTimestamp`, `sessions`, `registeredGroups`, `lastAgentTimestamp` —
the latter two now hold `(timestamp,id)` keyset cursors built by
`buildMessageCursor`, not bare timestamps), runs the message poll loop, wires the
channel(s), `GroupQueue`, IPC watcher and scheduler together, processes a group's
pending messages, and handles graceful shutdown.

**Key exports**:
- `getAvailableGroups(): AvailableGroup[]` — group chats annotated with
  registration status (consumed by the IPC watcher / groups snapshot).
- `_setRegisteredGroups(...)` — **test-only**; overwrites the in-memory group
  map.

**Collaborators (imports)**: nearly everything — `config`, `channels/whatsapp`,
`container-runner`, `container-runtime`, `db`, `group-queue`, `group-folder`,
`ipc`, `router`, `task-scheduler`, `types`, `logger` (12 internal modules).

**Importers**: none (entry point).

**Notes**: Provides the dependency callbacks (`IpcDeps`,
`SchedulerDependencies`, `WhatsAppChannelOpts`) that let the leaf modules call
back into orchestrator state without importing it — keeping the graph acyclic.

---

## Channels

### channels/whatsapp

**File**: `src/channels/whatsapp.ts` · **Module**: channels

**Responsibility**: WhatsApp transport over `@whiskeysockets/baileys`.
Implements `Channel`: connection/auth lifecycle (multi-file auth state under
`STORE_DIR/auth`), inbound message delivery, chat-metadata discovery, outbound
send with an offline retry queue, typing indicators, and 24h-cached group
metadata sync.

**Key exports**: `WhatsAppChannel` (class), `WhatsAppChannelOpts` (interface).

**Collaborators (imports)**: `config` (`ASSISTANT_HAS_OWN_NUMBER`,
`ASSISTANT_NAME`, `STORE_DIR`), `db` (`getLastGroupSync`, `setLastGroupSync`,
`updateChatName`), `logger`, `types` (`Channel`, callbacks, `RegisteredGroup`).

**Importers**: `index`.

**Notes**: Delivers full message content only for registered groups; always
emits chat metadata for discovery. Detects bot messages via `fromMe` (own
number) or an `<ASSISTANT_NAME>:` content prefix (shared number). Translates
`@lid` JIDs to phone JIDs via a local cache + Baileys' signal repository. A QR
prompt means re-auth is needed and the process exits. Reconnect first **tears
down the old socket** — removes its `connection.update` / `creds.update` /
`messages.upsert` listeners and calls `sock.end()` — before creating a new
`WASocket`, so reconnect loops don't leak sockets/listeners or double-deliver
messages. A sibling `src/whatsapp-auth.ts` script handles interactive
authentication (no exports; not part of the runtime surface).

---

## Execution

### container-runner

**File**: `src/container-runner.ts` · **Module**: root

**Responsibility**: Run the agent for a group and bridge its I/O. Builds the
volume-mount set (group folder, per-group `.claude/`, synced skills, per-group
IPC namespace, per-group `agent-runner` source, validated additional mounts,
and — for main — the read-only project root), spawns the container (or a host
process), injects secrets via stdin, stream-parses output markers, enforces
idle/hard timeouts, writes run logs, and writes the tasks/groups IPC snapshots.

**Key exports**: `runContainerAgent`, `writeTasksSnapshot`,
`writeGroupsSnapshot`; interfaces `ContainerInput`, `ContainerOutput`,
`AvailableGroup`.

**Collaborators (imports)**: `config`, `env` (`readEnvFile` for secrets),
`fs-sync` (`syncDirIfChanged`), `group-folder`, `logger`, `container-runtime`
(`bindMountArgs`, `getContainerSpawnCommand`, `isHostMode`, `stopContainer`),
`mount-security` (`validateAdditionalMounts`), `types`.

**Importers**: `index`, `task-scheduler`, `ipc` (type-only: `AvailableGroup`).

**Notes**: Secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`) are read
from `.env` at run time, written to the agent's stdin, and never persisted or
mounted. The shared `driveAgentProcess` helper gives container and host modes
identical protocol/timeout/logging behavior. Group agent timeouts are clamped to
`[> 0, 24h]`. Output markers: `---NANOCLAW_OUTPUT_START---` /
`---NANOCLAW_OUTPUT_END---` (must match the agent-runner).

### container-runtime

**File**: `src/container-runtime.ts` · **Module**: root

**Responsibility**: The single place all runtime-specific logic lives. Resolves
which runtime to use from `CONTAINER_RUNTIME` (`auto` probes docker/podman/
container; explicit names; or `host`), and provides mount-arg construction,
spawn-command resolution (Windows-safe), stop/cleanup, and a runtime-health
preflight.

**Key exports**: `resolveRuntime`, `isHostMode`, `getContainerSpawnCommand`,
`normalizeMountSource`, `bindMountArgs`, `readonlyMountArgs`, `stopContainer`,
`ensureContainerRuntimeRunning`, `cleanupOrphans`; interface `ResolvedRuntime`;
constants `RUNTIME_KIND`, `CONTAINER_RUNTIME_BIN`.

**Collaborators (imports)**: `logger` only (plus `child_process.execSync`).

**Importers**: `container-runner`, `index`.

**Notes**: `auto` never silently falls back to `host` — sandbox-free host mode
must be opted into explicitly. `resolveRuntime` is pure (binary-availability
probe injected) so it is unit-testable; module-load `RUNTIME_KIND` /
`CONTAINER_RUNTIME_BIN` capture the live resolution.

### group-queue

**File**: `src/group-queue.ts` · **Module**: root

**Responsibility**: Concurrency control. Serializes work per group (one active
container per group), caps the global active count at
`MAX_CONCURRENT_CONTAINERS`, parks over-limit work in a waiting list, and drains
it as slots free. Routes follow-up messages and close signals to active
containers via IPC input files.

**Key exports**: `GroupQueue` (class — `setProcessMessagesFn`,
`enqueueMessageCheck`, `enqueueTask`, `registerProcess`, `notifyIdle`,
`sendMessage`, `closeStdin`, `shutdown`).

**Collaborators (imports)**: `config` (`MAX_CONCURRENT_CONTAINERS`),
`group-folder` (`resolveGroupIpcPath`), `logger`.

**Importers**: `index`, `task-scheduler`.

**Notes**: Tasks are prioritized over message checks (preemption and drain).
Failed message runs retry with exponential backoff (5 retries, base 5s).
`shutdown` deliberately **detaches** active containers rather than killing them
— `--rm` cleans them up on exit, so WhatsApp reconnection restarts don't kill
in-flight agents.

### task-scheduler

**File**: `src/task-scheduler.ts` · **Module**: root

**Responsibility**: Drives scheduled tasks. Polls due tasks every
`SCHEDULER_POLL_INTERVAL`, re-checks each is still `active`, and enqueues it on
the `GroupQueue`. Per task: refreshes the tasks snapshot, runs the agent once,
forwards any result to the chat, computes the next run (cron/interval) or
completes (`once`), and writes a run log.

**Key exports**: `startSchedulerLoop`, `_resetSchedulerLoopForTests`
(**test-only**); interface `SchedulerDependencies`.

**Collaborators (imports)**: `config`, `container-runner`, `db`, `group-queue`,
`group-folder`, `logger`, `types`, plus `cron-parser`.

**Importers**: `index`.

**Notes**: `group` context-mode tasks reuse the group's current session;
`isolated` tasks start fresh. After a result, the task container is closed
promptly (`TASK_CLOSE_DELAY_MS = 10s`) rather than waiting the full idle
timeout, since tasks are single-turn. A task is **paused** (status `'paused'`) to
stop retry churn when (a) its `group_folder` is malformed/legacy, (b) its
`schedule_value` is corrupt so the next run can't be computed (bad cron, NaN /
out-of-range interval), or (c) it is a `once` task that errored — in each case
the bad task stays visible for the user to fix and resume.

---

## Messaging & IPC

### ipc

**File**: `src/ipc.ts` · **Module**: root

**Responsibility**: File-based IPC bridge from agents back to the orchestrator.
Polls each `DATA_DIR/ipc/<group>/{messages,tasks}` directory and dispatches:
outbound messages and task control (`schedule_task`, `pause_task`,
`resume_task`, `cancel_task`, `refresh_groups`, `register_group`).

**Key exports**: `startIpcWatcher`, `processTaskIpc`, `_resetIpcWatcherForTests`
(**test-only**); interface `IpcDeps`.

**Collaborators (imports)**: `config`, `container-runner` (type
`AvailableGroup`), `db` (`createTask`, `deleteTask`, `getTaskById`,
`updateTask`), `group-folder` (`isValidGroupFolder`), `logger`, `types`, plus
`cron-parser`.

**Importers**: `index`.

**Notes**: Authorization is grounded in the **source directory name**, not file
contents — an agent can only write into its own IPC namespace, so it cannot
forge a source identity. Non-main groups can only act on their own
chats/tasks/folder; `refresh_groups` and `register_group` are main-only, and
`register_group` rejects folder/JID hijack against the UNIQUE folder column.
Malformed files are quarantined under `ipc/errors/`.

### router

**File**: `src/router.ts` · **Module**: root

**Responsibility**: Pure message formatting/routing helpers — XML-escape and
wrap inbound messages for the prompt, strip `<internal>` markup from outbound
text, and pick the channel that owns a JID.

**Key exports**: `escapeXml`, `formatMessages`, `stripInternalTags`,
`formatOutbound`, `findChannel`.

**Collaborators (imports)**: `types` only.

**Importers**: `index`.

**Notes**: `formatOutbound` is currently a thin alias over `stripInternalTags`,
serving as the outbound-sanitization extension point.

---

## Persistence & State

### db

**File**: `src/db.ts` · **Module**: root

**Responsibility**: All SQLite persistence (`better-sqlite3`). Owns the schema
(chats, messages, scheduled_tasks, task_run_logs, router_state, sessions,
registered_groups), idempotent migrations, a one-time JSON-state migration, and
typed accessors for every table.

**Key exports**: `initDatabase`, `_initTestDatabase` (**test-only**),
`buildMessageCursor` (keyset-cursor helper), chat/metadata accessors
(`storeChatMetadata`, `updateChatName`, `getAllChats`, `getLastGroupSync`,
`setLastGroupSync`), message accessors (`storeMessage`, `getNewMessages`,
`getMessagesSince`), task accessors (`createTask`,
`getTaskById`, `getTasksForGroup`, `getAllTasks`, `updateTask`, `deleteTask`,
`getDueTasks`, `updateTaskAfterRun`, `logTaskRun`), state/session accessors
(`getRouterState`, `setRouterState`, `getSession`, `setSession`,
`getAllSessions`), registered-group accessors (`getRegisteredGroup`,
`setRegisteredGroup`, `getAllRegisteredGroups`); interface `ChatInfo`.

**Collaborators (imports)**: `config` (`ASSISTANT_NAME`, `DATA_DIR`,
`STORE_DIR`), `group-folder` (`isValidGroupFolder`), `logger`, `types`.

**Importers**: `index`, `task-scheduler`, `ipc`, `channels/whatsapp`.

**Notes**: Bot messages are filtered both by the `is_bot_message` flag and a
content-prefix backstop (for pre-migration rows). Registered-group rows with an
invalid folder are skipped on read and rejected on write. `initDatabase` must be
called before any accessor. The message cursor is a `(timestamp, id)` **keyset**
encoded as `"timestamp|id"` (built by `buildMessageCursor`) — WhatsApp
timestamps have only second resolution, so a bare-timestamp cursor could drop a
same-second message; `getNewMessages` returns the advanced cursor as `newCursor`
and a bare-timestamp legacy cursor is read back exclusively (max-id sentinel).

---

## Security & Paths

### mount-security

**File**: `src/mount-security.ts` · **Module**: root

**Responsibility**: Validate group-supplied `AdditionalMount`s against an
external, container-invisible allowlist before they become container `-v` args.
Enforces blocked patterns (secrets dirs/files), allowed-root containment,
read-only policy, and host/container path sanitization (colons, control chars,
`..`).

**Key exports**: `loadMountAllowlist`, `validateMount`,
`validateAdditionalMounts`, `generateAllowlistTemplate`,
`hostPathHasDisallowedColon`, `_resetMountAllowlistCache` (**test-only**);
interface `MountValidationResult`.

**Collaborators (imports)**: `config` (`MOUNT_ALLOWLIST_PATH`), `logger`,
`types` (`AdditionalMount`, `AllowedRoot`, `MountAllowlist`).

**Importers**: `container-runner`.

**Notes**: The allowlist lives at `~/.config/nanoclaw/mount-allowlist.json` and
is never mounted into a container (tamper-proof from agents). Default blocked
patterns (`.ssh`, `.aws`, `.env`, `id_rsa`, ...) are merged with user-supplied
ones. Missing/invalid allowlist ⇒ all additional mounts blocked. The cache lives
for the process lifetime; `_resetMountAllowlistCache` exists so tests can vary
configurations.

### group-folder

**File**: `src/group-folder.ts` · **Module**: root

**Responsibility**: Validate group folder names and resolve them to absolute
paths confined to their base directory.

**Key exports**: `isValidGroupFolder`, `resolveGroupFolderPath`,
`resolveGroupIpcPath`.

**Collaborators (imports)**: `config` (`DATA_DIR`, `GROUPS_DIR`).

**Importers**: `db`, `container-runner`, `group-queue`, `ipc`, `task-scheduler`,
`index` (6 files — a widely shared security primitive).

**Notes**: The folder pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` excludes path
separators and dots, so `..` traversal is impossible by construction; `global`
is reserved. Resolution re-checks the path stays within its base
(`ensureWithinBase`) as defense-in-depth.

---

## Foundations

### config

**File**: `src/config.ts` · **Module**: root

**Responsibility**: Central configuration — assistant identity, poll intervals,
absolute paths (store/groups/data, mount allowlist), container settings,
concurrency cap, trigger regex, timezone.

**Key exports**: 17 constants (see [API.md → config](./API.md#config)).

**Collaborators (imports)**: `env` (`readEnvFile`).

**Importers**: 9 files (the most widely imported module after `logger`).

**Notes**: Secrets are intentionally **not** read here; they are loaded only in
`container-runner` to avoid leaking into the process environment / child
processes. `TRIGGER_PATTERN` is built by regex-escaping `ASSISTANT_NAME`.

### env

**File**: `src/env.ts` · **Module**: root

**Responsibility**: Parse `.env` for specific keys without polluting
`process.env`.

**Key exports**: `readEnvFile`.

**Collaborators (imports)**: `logger`.

**Importers**: `config`, `container-runner`.

**Notes**: Returns only the requested keys; strips matching quotes; ignores
comments/blank lines; returns `{}` when `.env` is absent. Keeping values out of
`process.env` prevents secrets from leaking to spawned children.

### fs-sync

**File**: `src/fs-sync.ts` · **Module**: root

**Responsibility**: Content-aware directory sync — copy a source tree to a
destination only when its content has actually changed.

**Key exports**: `hashDir`, `syncDirIfChanged`.

**Collaborators (imports)**: none internal (uses `crypto`, `fs`, `path`).

**Importers**: `container-runner`.

**Notes**: Used to propagate the upstream `agent-runner` source into each
group's writable copy after an update without clobbering on every run, tracked
via a sibling `<destDir>.hash` SHA-256 stamp.

### logger

**File**: `src/logger.ts` · **Module**: root

**Responsibility**: Shared `pino` logger plus process-level
`uncaughtException` / `unhandledRejection` handlers.

**Key exports**: `logger`.

**Collaborators (imports)**: `pino` only.

**Importers**: 10 files (the most widely imported leaf).

**Notes**: Level from `LOG_LEVEL` (default `info`); `pino-pretty` transport.
`uncaughtException` logs fatal and exits; `unhandledRejection` logs an error.

### types

**File**: `src/types.ts` · **Module**: root

**Responsibility**: Shared type definitions — no runtime code.

**Key exports**: `AdditionalMount`, `MountAllowlist`, `AllowedRoot`,
`ContainerConfig`, `RegisteredGroup`, `NewMessage`, `ScheduledTask`,
`TaskRunLog`, `Channel`, `OnInboundMessage`, `OnChatMetadata`.

**Collaborators (imports)**: none.

**Importers**: 8 files.

**Notes**: `Channel` is the abstraction each transport implements; the `On*`
callbacks are how channels deliver inbound messages/metadata back to the
orchestrator without importing it.

---

## Component Dependencies

Import counts from the dependency graph (`i` = files imported, `o` = files this
is exported to):

| Component | imports | exported to | Role |
|-----------|:-------:|:-----------:|------|
| `index` | 12 | 0 | Entry / orchestrator |
| `container-runner` | 8 | 3 | Agent execution + IPC snapshots |
| `task-scheduler` | 7 | 1 | Scheduled task driver |
| `ipc` | 6 | 1 | Agent → orchestrator IPC watcher |
| `db` | 4 | 4 | SQLite persistence |
| `channels/whatsapp` | 4 | 1 | WhatsApp transport |
| `group-queue` | 3 | 2 | Concurrency control |
| `mount-security` | 3 | 1 | Additional-mount allowlist |
| `config` | 1 | 9 | Configuration |
| `group-folder` | 1 | 6 | Folder validation / path resolution |
| `container-runtime` | 1 | 2 | Runtime abstraction |
| `env` | 1 | 2 | `.env` reader |
| `router` | 1 | 1 | Message formatting/routing |
| `fs-sync` | 0 | 1 | Content-aware sync |
| `logger` | 0 | 10 | Logging |
| `types` | 0 | 8 | Shared types |

**No circular dependencies.** The graph flows from the `index` entry point down
through execution/IPC/scheduler into persistence, with `config`, `logger`,
`types`, and `group-folder` as widely shared leaves.

---

## Auxiliary Modules

These four modules ship in the repo but run outside the orchestrator runtime:
`skills-engine/` powers the `/customize` · `/update` · `/uninstall` skill
lifecycle, `setup/` is the `/setup` install wizard, `scripts/` are CLI/CI
entry points, and `container/agent-runner/` is the process that runs **inside**
each agent container. Per-export signatures are in
[API.md → Auxiliary modules](./API.md#auxiliary-modules).

### skills-engine

**Files**: 22 (`skills-engine/*.ts`). **Barrel**: `index.ts` re-exports the
whole public surface (60 re-exports).

**Responsibility**: Apply, update, rebase, customize, and uninstall "skills"
(versioned patch bundles) on top of a pristine base snapshot kept under
`.nanoclaw/`. Each skill declares `adds` / `modifies` / structured edits
(`npm_dependencies`, `env_additions`, `docker_compose_services`) and `file_ops`
in a `manifest.yaml`; the engine three-way-merges them against the base and the
user's working tree using git, with `rerere`-backed conflict caching and a
resolution cache so previously-resolved merges replay automatically.

**Key submodules & exports**:
- `apply.ts` → `applySkill(skillDir): Promise<ApplyResult>` — the apply
  pipeline (manifest checks → backup → lock → merge → structured merges →
  file-ops → state record).
- `update.ts` → `previewUpdate(newCorePath)`, `applyUpdate(newCorePath)` — pull
  an upstream core, preview risk, then merge + reapply skills/custom patches.
- `rebase.ts` → `rebase(newBasePath?)`; `customize.ts` →
  `startCustomize` / `commitCustomize` / `abortCustomize` / `isCustomizeActive`;
  `uninstall.ts` → `uninstallSkill`; `migrate.ts` → `initSkillsSystem` /
  `migrateExisting`; `replay.ts` → `findSkillDir` / `replaySkills`;
  `init.ts` → `initNanoclawDir`.
- Foundations: `state.ts` (state file + `compareSemver`, `computeFileHash`),
  `manifest.ts` (parse + `check*` gates), `merge.ts` (git three-way merge +
  rerere), `structured.ts` (npm/env/compose merges + `runNpmInstall`),
  `backup.ts`, `lock.ts`, `path-remap.ts`, `resolution-cache.ts`,
  `file-ops.ts`, `fs-utils.ts` (`toPosix`, `copyDir`), `constants.ts`,
  `git-utils.ts`, and `types.ts` (14 interfaces, the only non-`src` type home).

**Notes**: `git-utils.ts` exports `gitDiffNoIndex(args, cwd)`, which shells out
to `git diff --no-index` to produce git-format patches.
`customize.ts`, `migrate.ts`, and `rebase.ts` use it instead of the POSIX `diff`
binary — git is already a hard dependency, whereas `diff` is often absent from
PATH on Windows, where `diff`-based patches silently failed. `UpdateResult` now
carries `deletionConflicts?: string[]`: files removed upstream that an applied
skill / custom modification still touches are **preserved** (not deleted) so
those edits aren't silently lost.

### setup

**Files**: 12 (`setup/*.ts`). **Entry**: `setup/index.ts` (the `/setup` CLI),
which dynamically imports each step in order.

**Responsibility**: Cross-platform install wizard. Each step file exports a
`run(args)` and emits a parseable status block via `status.ts`'s `emitStatus`:
`environment` (detect OS/Node/runtimes), `container` (build + smoke-test the
image), `whatsapp-auth` (QR/pairing flow), `groups` (fetch + persist group
metadata), `register` (write channel registration + group folders), `mounts`
(write the mount allowlist), `service` (install the OS service), `verify`
(end-to-end health check).

**Key shared exports**:
- `platform.ts` — OS/runtime detection: `getPlatform`, `isWindows`, `isWSL`,
  `isRoot`, `isHeadless`, `hasSystemd`, `openBrowser`, `getServiceManager`,
  `getNodePath`, `commandExists`, `getNodeVersion`, `getNodeMajorVersion`.
- `service.ts` — `run`, plus the Windows path: `WINDOWS_TASK_NAME` (`'NanoClaw'`),
  `generateWindowsLauncher(projectRoot, nodePath)` (restart-loop `.cmd`),
  `windowsScheduledTaskArgs(taskName, launcherPath)` (the `schtasks /Create`
  argv).
- `node-script.ts` — `runNodeScript(source, opts)` runs an inline ESM snippet in
  a throwaway file (used to call into `src/` from setup steps).
- `status.ts` — `emitStatus(step, fields)`.

**Notes**: Steps import the orchestrator's `src/config`, `src/db`,
`src/group-folder`, and `src/logger` so registration and verification use the
same paths/validation as the running process.

### scripts

**Files**: 6 (`scripts/*.ts`), all CLI entry points.

**Responsibility**: Thin CLIs over `skills-engine`: `apply-skill.ts`
(`applySkill`), `update-core.ts` (`previewUpdate` / `applyUpdate`),
`post-update.ts` (`clearBackup`), `run-migrations.ts` (runs versioned migration
scripts under tsx, using `compareSemver`). `generate-ci-matrix.ts` and
`run-ci-tests.ts` build the skill-overlap CI matrix.

**Key exports**: only `generate-ci-matrix.ts` exports a reusable surface —
`extractOverlapInfo`, `computeOverlapMatrix`, `readAllManifests`,
`generateMatrix` (interfaces `MatrixEntry`, `SkillOverlapInfo`); the other five
scripts have no exports.

### container/agent-runner

**Files**: 2 (`container/agent-runner/src/*.ts`). No exports — both are
executables that run **inside** the agent container (a separate npm package).

**Responsibility**: `index.ts` is the agent process: it reads a `ContainerInput`
JSON from stdin, drives the Claude Agent SDK `query()` loop, polls
`/workspace/ipc/input/` for follow-up `{type:"message"}` files and the `_close`
sentinel, and emits each `ContainerOutput` wrapped in
`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` markers (these must
match `src/container-runner.ts`). `ipc-mcp-stdio.ts` is a stdio MCP server
exposing IPC/scheduling tools (messaging, task scheduling via `cron-parser`,
group registration) to the in-container agent.

**Notes**: This package is built separately (`npm install && npm run build` in
`container/agent-runner`) and is required for `host` mode, where there is no
container image to carry it.

---

**Document Version**: 1.1.0
**Last Updated**: 2026-06-01
