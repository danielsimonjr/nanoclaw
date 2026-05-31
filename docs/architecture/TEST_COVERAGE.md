# Test Coverage Analysis

**Generated**: 2026-05-31

The full test suite is **458 tests across 42 files** (18 source-level suites, 4 setup suites, and supporting files), all green. Tests use [Vitest](https://vitest.dev/) with in-memory SQLite (`_initTestDatabase`) and surgical vi.mock for filesystem/process/config boundaries.

---

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 17 |
| Total Test Files | 18 |
| Source Files with Tests | 16 |
| Source Files without Tests | 1 |
| File-level Coverage | 94.1% |

> **Note**: "file-level coverage" means each source file is directly imported by at least one test file. It does not measure line or branch coverage within files — some code paths (e.g., graceful shutdown, reconnect loops, QR code handling) are exercised indirectly or not at all.

---

## How to Run

```bash
npm test            # run the full suite once
npm run typecheck   # TypeScript type-check without running tests
```

Tests that touch the filesystem create real temporary directories under `os.tmpdir()` and clean up in `afterAll`. All other I/O is mocked via `vi.mock`.

---

## Source Files Without Test Coverage

### `src/whatsapp-auth.ts`

This file is a self-executing setup script that writes WhatsApp QR-code authentication state to disk by launching a temporary Baileys socket, printing the QR to the terminal, and waiting for the user to scan it. It has no testable return value, no dependency-injected interfaces, and cannot run in a headless CI environment (it requires a real WhatsApp connection and interactive TTY). The logic is extremely thin: open socket, print QR, wait for `connection === 'open'`, exit. There is no domain logic to unit-test, and the behavior is validated by the `/setup` flow rather than automated tests.

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `src/channels/whatsapp.ts` | `channels/whatsapp.test.ts` |
| `src/config.ts` | `src/formatting.test.ts` |
| `src/container-runner.ts` | `src/container-runner-host.test.ts`, `src/container-runner.test.ts` |
| `src/container-runtime.ts` | `src/container-runtime.test.ts` |
| `src/db.ts` | `channels/whatsapp.test.ts`, `src/db-accessors.test.ts`, `src/db.test.ts`, `src/ipc-auth.test.ts`, `src/ipc-watcher.test.ts`, `src/routing.test.ts`, `src/task-scheduler-run.test.ts`, `src/task-scheduler.test.ts` |
| `src/env.ts` | `src/env.test.ts` |
| `src/fs-sync.ts` | `src/fs-sync.test.ts` |
| `src/group-folder.ts` | `src/group-folder.test.ts` |
| `src/group-queue.ts` | `src/group-queue.test.ts` |
| `src/index.ts` | `src/routing.test.ts` |
| `src/ipc.ts` | `src/ipc-auth.test.ts`, `src/ipc-watcher.test.ts` |
| `src/logger.ts` | `src/container-runtime.test.ts` |
| `src/mount-security.ts` | `src/mount-security.test.ts` |
| `src/router.ts` | `src/formatting.test.ts`, `src/router-routing.test.ts` |
| `src/task-scheduler.ts` | `src/task-scheduler-run.test.ts`, `src/task-scheduler.test.ts` |
| `src/types.ts` | (imported by 9 test files) |

---

## Per-Suite Breakdown

### Security

**`src/mount-security.test.ts`** — `src/mount-security.ts`

Verifies the additional-mount allowlist system that prevents container agents from escalating filesystem access. Tests cover:
- `loadMountAllowlist`: missing file returns null; invalid JSON cached as failure; `allowedRoots` must be an array; `nonMainReadOnly` must be a boolean; user-provided `blockedPatterns` are merged with built-in defaults (`.ssh`, `id_rsa`, etc.); successful load is cached.
- `validateMount` allowlist gating: no allowlist blocks all mounts; path under an allowed root is permitted; path outside is rejected; non-existent path rejected.
- `validateMount` blocked patterns: `.ssh` directories blocked even under an allowed root; case-insensitive matching catches `.SSH` and `Credentials`.
- `validateMount` container path validation: `..` traversal rejected; absolute paths rejected; colon injection (e.g., `foo:rw`) rejected; null byte rejected; defaults basename when no container path given.
- `validateMount` malformed host path: undefined host path does not throw; empty/whitespace path rejected; colon and control characters in host path rejected.
- `validateMount` symlink escape: symlink inside an allowed root that resolves outside is rejected via `fs.realpathSync`; symlink that resolves inside is allowed.
- `validateMount` read/write downgrade: main group gets read-write on an rw root; root configured read-only overrides the request; `nonMainReadOnly=true` forces read-only for non-main groups.
- `validateAdditionalMounts`: returns only passing mounts prefixed with `/workspace/extra/`; empty array when all rejected.
- `generateAllowlistTemplate`: produces valid JSON shaped like a `MountAllowlist`.
- `hostPathHasDisallowedColon`: POSIX rejects any colon; Windows permits single drive-letter colon but rejects NTFS streams and multi-colon paths.

**`src/ipc-auth.test.ts`** — `src/ipc.ts`, `src/db.ts`

Directly calls `processTaskIpc` with crafted inputs to verify every authorization gate. Tests cover:
- *schedule_task*: main can schedule for another group; non-main can schedule for itself; non-main cannot schedule for another group; unregistered target JID rejected.
- *pause_task / resume_task / cancel_task*: main can act on any task; non-main can act on its own tasks; non-main cannot act on another group's tasks.
- *register_group*: non-main group cannot register; unsafe folder path (`../../outside`) rejected; main can register a brand-new JID+folder; folder-hijack guard rejects re-binding an existing folder to a different JID; re-pointing an existing JID to a different folder also rejected; missing required fields rejected.
- *refresh_groups*: non-main group cannot trigger a metadata refresh.
- *IPC message authorization* (the `isMain || targetGroup.folder === sourceGroup` check): main can send to any JID including unregistered; non-main can only send to its own chat.
- *schedule_task schedule types*: cron with `next_run` computed; invalid cron expression rejected; interval `next_run` correct to within 1 s; invalid interval (non-numeric, zero) rejected; invalid once timestamp rejected.
- *context_mode*: `group` and `isolated` accepted; invalid mode defaults to `group`; missing mode defaults to `group`.

**`src/ipc-watcher.test.ts`** — `src/ipc.ts`, `src/db.ts`

Tests the full file-based watcher loop using a real temporary directory and fake timers. Tests cover:
- Message authorization: authorized message delivered and file consumed; non-main group spoofing another chat blocked (file still consumed); main group can send to any chat; malformed JSON quarantined to `errors/` directory; the reserved `errors/` directory is skipped during group scanning.
- Task routing: group schedules task for itself via file — task appears in SQLite; malformed task file quarantined.

### Data Layer

**`src/db.test.ts`** — `src/db.ts`

Core schema and migration tests. Uses in-memory SQLite. Tests the `context_mode` column migration (idempotent `ALTER TABLE`).

**`src/db-accessors.test.ts`** — `src/db.ts`, `src/types.ts`

Thorough tests of every exported accessor. Covers `storeMessage`, `getNewMessages` (cursor, bot filtering, multi-group), `getMessagesSince`, `createTask` / `getTaskById` / `getAllTasks` / `updateTask` / `deleteTask` / `getDueTasks` / `updateTaskAfterRun` / `logTaskRun`, `storeChatMetadata` (upsert with COALESCE), `updateChatName`, `getAllChats`, `setRegisteredGroup` / `getRegisteredGroup` / `getAllRegisteredGroups` (including folder-safety validation), `setSession` / `getAllSessions`, `setRouterState` / `getRouterState`.

**`src/channels/whatsapp.test.ts`** — `src/channels/whatsapp.ts`, `src/db.ts`

WhatsApp channel behavior without a real socket. Tests `sendMessage` queuing when disconnected, `flushOutgoingQueue` behavior on reconnect (re-queues on failure), `ownsJid` routing, and basic inbound message handling.

### Runtime and Container

**`src/container-runner.test.ts`** — `src/container-runner.ts`, `src/types.ts`

Tests `driveAgentProcess` behavior via a controllable fake `ChildProcess` (EventEmitter + PassThrough streams). Uses container mode (mock `isHostMode = false`). Covers:
- Streamed OUTPUT markers: single result, multiple results, partial buffer (marker split across chunks), newSessionId extraction.
- Timeout: hard timeout with no output → `status: 'error'`; timeout after output → `status: 'success'` (idle cleanup path).
- Stdin secrets: `input.secrets` is present when stdin is written, absent from the object after; run log does not contain secret values.
- Exit codes: non-zero exit with no output → error; zero exit → success.
- `onOutput` callback errors do not crash the driver.

**`src/container-runner-host.test.ts`** — `src/container-runner.ts`, `src/types.ts`

Same driver behavior as above, but with `isHostMode = true` (mocked). Adds:
- Missing agent-runner build returns `{status:'error'}` without spawning.
- `spawn` is called with `process.execPath` and the `dist/index.js` entry point.
- Secrets / timeout / output streaming behavior is identical to container mode (shared `driveAgentProcess`).

**`src/container-runtime.test.ts`** — `src/container-runtime.ts`, `src/logger.ts`

Tests runtime detection (`CONTAINER_RUNTIME` env var), `isHostMode()`, `bindMountArgs` for Docker and Podman flag formats, and `stopContainer` command construction.

### Scheduler

**`src/task-scheduler.test.ts`** — `src/task-scheduler.ts`, `src/db.ts`

Tests the scheduler loop's safety guard: a due task with an invalid `group_folder` path (`../../outside`) is immediately paused in SQLite to prevent retry churn, and the error is logged.

**`src/task-scheduler-run.test.ts`** — `src/task-scheduler.ts`, `src/db.ts`, `src/types.ts`

End-to-end task execution with a mocked `runContainerAgent`. Tests cover:
- Successful task run: `logTaskRun` written, `updateTaskAfterRun` called with correct `nextRun` for interval and cron types; `once` tasks transition to `completed`.
- `context_mode=group` uses the group's current session ID; `context_mode=isolated` uses no session.
- Agent error: `logTaskRun` records the error; task status not changed.
- `sendMessage` called with the streamed result.
- Task skipped if not found in registered groups.

### IPC

Covered by **`src/ipc-auth.test.ts`** and **`src/ipc-watcher.test.ts`** described above under Security.

### GroupQueue

**`src/group-queue.test.ts`** — `src/group-queue.ts`

Tests the concurrency and ordering invariants. Uses fake timers. Covers:
- At most one container active per group simultaneously (serialization).
- Global `MAX_CONCURRENT_CONTAINERS` ceiling: groups beyond the limit are queued in `waitingGroups` and unblocked as slots free.
- Tasks drain before pending messages (`drainGroup` priority).
- `notifyIdle` + pending tasks triggers `closeStdin` immediately.
- `sendMessage` writes to the IPC input directory and returns `true`; returns `false` when no active container or for task containers.
- Retry with exponential backoff on failure; max-retry reached drops messages and resets count.
- `shutdown` detaches containers without killing them.

### Formatting and Routing

**`src/formatting.test.ts`** — `src/router.ts`, `src/config.ts`, `src/types.ts`

Tests `escapeXml` (all five XML special characters), `formatMessages` (XML envelope format, multi-sender, timestamp, sender name), `formatOutbound` (`<internal>` tag stripping), `stripInternalTags`, and `TRIGGER_PATTERN` matching.

**`src/router-routing.test.ts`** — `src/router.ts`, `src/types.ts`

Tests `findChannel` (returns the channel that owns a given JID, or undefined) and `ownsJid` delegation.

**`src/routing.test.ts`** — `src/index.ts`, `src/db.ts`

Tests `getAvailableGroups`: returns only group chats (filters DMs and `__group_sync__` sentinel), includes `isRegistered` flag correctly, ordered by last activity.

### Platform and Windows

**`setup/platform.test.ts`** — `setup/platform.ts`

Sanity tests for `getServiceManager`, `commandExists` (real `node` binary exists; invented binary does not), and `getNodeVersion` format.

**`setup/platform-windows.test.ts`** — `setup/platform.ts` (with `os.platform` mocked to `win32`)

Tests all platform-detection functions under a simulated native Windows host: `getPlatform` returns `'windows'`; `getServiceManager` returns `'schtasks'`; `isWSL`/`hasSystemd` are false; `commandExists` uses `where` instead of `which`; `getNodePath` returns the correct path; `openBrowser` calls `start`.

**`setup/environment.test.ts`** and **`setup/service.test.ts`** — setup helpers

Verify environment variable collection and service file generation for each platform (launchd plist, systemd unit, schtasks XML).

### Host Mode

Covered by **`src/container-runner-host.test.ts`** described above under Runtime and Container.

---

## Coverage Gap: `src/whatsapp-auth.ts`

As described above, this file is exempt because it is an interactive setup script with no testable unit interface. Coverage is validated by the `/setup` skill's end-to-end flow.
