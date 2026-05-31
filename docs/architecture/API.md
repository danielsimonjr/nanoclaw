# NanoClaw — API Reference

Reference for the exported (`src/`) runtime surface of NanoClaw. For
architecture rationale see [REQUIREMENTS.md](../REQUIREMENTS.md); for the
machine-generated export inventory and import graph see
[DEPENDENCY_GRAPH.md](./DEPENDENCY_GRAPH.md). This document covers the **17
TypeScript files under `src/`** that the dependency tool scanned (85 exports
total) and copies signatures verbatim from source.

> **Scope.** This reference documents the `src/` orchestrator runtime only.
> The repository also contains `setup/`, `skills-engine/`, and
> `container/agent-runner/` (the in-container agent), which run in separate
> processes/contexts and are out of scope here. Test-only exports (the
> `_`-prefixed functions) are documented and flagged as such.

---

## Table of Contents

1. [config](#config)
2. [env](#env)
3. [logger](#logger)
4. [types](#types)
5. [db](#db)
6. [group-folder](#group-folder)
7. [fs-sync](#fs-sync)
8. [container-runtime](#container-runtime)
9. [mount-security](#mount-security)
10. [container-runner](#container-runner)
11. [group-queue](#group-queue)
12. [ipc](#ipc)
13. [task-scheduler](#task-scheduler)
14. [router](#router)
15. [channels/whatsapp](#channelswhatsapp)
16. [index (entry)](#index-entry)

---

## config

`src/config.ts` — Reads config values from `.env` (falling back to
`process.env`) via `readEnvFile`. Secrets are deliberately **not** read here.
All exports are constants.

| Constant | Type | Value / Source |
|----------|------|----------------|
| `ASSISTANT_NAME` | `string` | `ASSISTANT_NAME` env / `.env`, default `'Andy'` |
| `ASSISTANT_HAS_OWN_NUMBER` | `boolean` | `ASSISTANT_HAS_OWN_NUMBER === 'true'` |
| `POLL_INTERVAL` | `number` | `2000` (ms) — message loop poll |
| `SCHEDULER_POLL_INTERVAL` | `number` | `60000` (ms) — scheduler loop poll |
| `MOUNT_ALLOWLIST_PATH` | `string` | `~/.config/nanoclaw/mount-allowlist.json` |
| `STORE_DIR` | `string` | `<projectRoot>/store` |
| `GROUPS_DIR` | `string` | `<projectRoot>/groups` |
| `DATA_DIR` | `string` | `<projectRoot>/data` |
| `MAIN_GROUP_FOLDER` | `string` | `'main'` |
| `CONTAINER_IMAGE` | `string` | `CONTAINER_IMAGE` env, default `'nanoclaw-agent:latest'` |
| `CONTAINER_TIMEOUT` | `number` | `CONTAINER_TIMEOUT` env, default `1800000` (30 min) |
| `CONTAINER_MAX_OUTPUT_SIZE` | `number` | default `10485760` (10 MB) |
| `IPC_POLL_INTERVAL` | `number` | `1000` (ms) |
| `IDLE_TIMEOUT` | `number` | `IDLE_TIMEOUT` env, default `1800000` (30 min) |
| `MAX_CONCURRENT_CONTAINERS` | `number` | `MAX_CONCURRENT_CONTAINERS` env, default `5`, min `1` |
| `TRIGGER_PATTERN` | `RegExp` | `^@<ASSISTANT_NAME>\b` (case-insensitive, regex-escaped) |
| `TIMEZONE` | `string` | `TZ` env or `Intl.DateTimeFormat().resolvedOptions().timeZone` |

---

## env

`src/env.ts`

### readEnvFile

Parse the project `.env` file and return values for the requested keys only.
Does **not** load anything into `process.env` (keeps secrets out of child
process environments). Strips matching single/double quotes; skips comments and
blank lines. Returns `{}` if `.env` is absent.

```typescript
function readEnvFile(keys: string[]): Record<string, string>
```

---

## logger

`src/logger.ts`

### logger

A configured `pino` instance (level from `LOG_LEVEL`, default `info`, pretty
transport). Importing this module also installs `uncaughtException` (fatal +
`process.exit(1)`) and `unhandledRejection` handlers. Imported by 10 modules.

```typescript
const logger: import('pino').Logger
```

---

## types

`src/types.ts` — Shared interfaces and callback types. No runtime code.

### AdditionalMount

```typescript
interface AdditionalMount {
  hostPath: string;        // Absolute path on host (supports ~ for home)
  containerPath?: string;  // Defaults to basename(hostPath); mounted at /workspace/extra/{value}
  readonly?: boolean;      // Default: true for safety
}
```

### MountAllowlist / AllowedRoot

Security configuration for additional mounts. Stored at
`~/.config/nanoclaw/mount-allowlist.json` and never mounted into a container
(tamper-proof from agents).

```typescript
interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];   // glob-ish substrings never mountable (e.g. ".ssh")
  nonMainReadOnly: boolean;    // if true, non-main groups are forced read-only
}

interface AllowedRoot {
  path: string;            // Absolute or ~ (e.g. "~/projects", "/var/repos")
  allowReadWrite: boolean; // Whether read-write mounts are allowed under this root
  description?: string;
}
```

### ContainerConfig

```typescript
interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;  // ms; defaults to CONTAINER_TIMEOUT (30 min), clamped to 24h max
}
```

### RegisteredGroup

```typescript
interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean;  // Default: true for groups, false for solo chats
}
```

### NewMessage

```typescript
interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}
```

### ScheduledTask

```typescript
interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}
```

### TaskRunLog

```typescript
interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}
```

### Channel + callbacks

The channel abstraction every transport (WhatsApp, Telegram, etc.) implements.

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;  // optional
}

type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;
```

---

## db

`src/db.ts` — SQLite (`better-sqlite3`) persistence. `messages.db` lives under
`STORE_DIR`. A module-level `db` handle is created by `initDatabase()`; calling
any accessor before init throws. Schema is created with `CREATE TABLE IF NOT
EXISTS` plus idempotent `ALTER TABLE` migrations.

### Lifecycle

```typescript
function initDatabase(): void          // Opens store/messages.db, creates schema, migrates JSON state
function _initTestDatabase(): void     // @internal (tests only) — fresh in-memory DB
```

### Chats / metadata

```typescript
interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void                                 // Upsert; preserves existing name when none supplied, keeps newer timestamp
function updateChatName(chatJid: string, name: string): void
function getAllChats(): ChatInfo[]      // Ordered by last_message_time DESC
function getLastGroupSync(): string | null
function setLastGroupSync(): void
```

### Messages

```typescript
function storeMessage(msg: NewMessage): void   // INSERT OR REPLACE; call only for registered groups

function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string }
// Returns messages newer than lastTimestamp across jids, excluding bot messages
// (is_bot_message flag AND content NOT LIKE "<botPrefix>:%"), with the advanced timestamp.

function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[]
```

### Scheduled tasks

```typescript
function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void
function getTaskById(id: string): ScheduledTask | undefined
function getTasksForGroup(groupFolder: string): ScheduledTask[]
function getAllTasks(): ScheduledTask[]
function updateTask(
  id: string,
  updates: Partial<Pick<ScheduledTask,
    'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'>>,
): void
function deleteTask(id: string): void           // Deletes child task_run_logs first (FK)
function getDueTasks(): ScheduledTask[]          // status='active' AND next_run <= now, ordered by next_run
function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void                                          // Sets status='completed' when nextRun is null
function logTaskRun(log: TaskRunLog): void
```

### Router state / sessions

```typescript
function getRouterState(key: string): string | undefined
function setRouterState(key: string, value: string): void

function getSession(groupFolder: string): string | undefined
function setSession(groupFolder: string, sessionId: string): void
function getAllSessions(): Record<string, string>   // groupFolder -> sessionId
```

### Registered groups

Rows whose `folder` fails `isValidGroupFolder` are skipped (read) or rejected
(write).

```typescript
function getRegisteredGroup(jid: string): (RegisteredGroup & { jid: string }) | undefined
function setRegisteredGroup(jid: string, group: RegisteredGroup): void   // Throws on invalid folder
function getAllRegisteredGroups(): Record<string, RegisteredGroup>       // jid -> group
```

---

## group-folder

`src/group-folder.ts` — Validates group folder names and resolves them to
absolute paths confined within their base directory. The folder pattern
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` excludes `/`, `\`, and `.`, so path
separators and `..` traversal are impossible; `global` is reserved.

```typescript
function isValidGroupFolder(folder: string): boolean
function resolveGroupFolderPath(folder: string): string  // Under GROUPS_DIR; throws if invalid/escaping
function resolveGroupIpcPath(folder: string): string     // Under DATA_DIR/ipc; throws if invalid/escaping
```

---

## fs-sync

`src/fs-sync.ts` — Content-aware directory sync (e.g. propagating
`agent-runner` source into each group).

```typescript
function hashDir(dir: string): string  // SHA-256 over sorted relative paths + file contents

function syncDirIfChanged(srcDir: string, destDir: string): void
// Copies srcDir -> destDir only when content changed since the last sync
// (tracked via a sibling `<destDir>.hash` stamp). No-op if srcDir is absent.
```

---

## container-runtime

`src/container-runtime.ts` — Single-file abstraction over the container
runtime. Selected via `CONTAINER_RUNTIME` (`auto` default, or
`docker` / `podman` / `container` / `host`). Resolution happens once at module
load.

```typescript
type RuntimeKind = 'container' | 'host';

interface ResolvedRuntime {
  kind: RuntimeKind;
  bin: string | null;  // runtime binary for container kinds; null for host / none found
}
```

### resolveRuntime

Pure resolver. `auto` (or any unrecognized value) probes `docker`, `podman`,
`container` in order via the injected `isAvailable`; it **never** silently falls
back to `host`, which must be requested explicitly.

```typescript
function resolveRuntime(
  envValue: string | undefined,
  isAvailable: (bin: string) => boolean,
): ResolvedRuntime
```

### Module constants

```typescript
const RUNTIME_KIND: RuntimeKind          // resolved kind ('container' | 'host')
const CONTAINER_RUNTIME_BIN: string      // resolved binary; falls back to 'docker'
```

### Helpers

```typescript
function isHostMode(): boolean                       // RUNTIME_KIND === 'host'
function getContainerSpawnCommand(): string          // command for spawn(); resolves full .exe path on Windows
function normalizeMountSource(hostPath: string): string  // backslashes -> forward slashes on Windows
function bindMountArgs(hostPath: string, containerPath: string, readonly: boolean): string[]  // ['-v', 'src:dst[:ro]']
function readonlyMountArgs(hostPath: string, containerPath: string): string[]                 // bindMountArgs(..., true)
function stopContainer(name: string): string         // "<bin> stop <name>"
function ensureContainerRuntimeRunning(): void       // probes `<bin> info`; throws (with banner) on failure; no-op in host mode
function cleanupOrphans(): void                       // stops leftover `nanoclaw-*` containers; no-op in host mode
```

---

## mount-security

`src/mount-security.ts` — Validates `AdditionalMount`s from group
`containerConfig` against the external allowlist. The allowlist is cached for
the process lifetime.

### MountValidationResult

```typescript
interface MountValidationResult {
  allowed: boolean;
  reason: string;
  realHostPath?: string;
  resolvedContainerPath?: string;
  effectiveReadonly?: boolean;
}
```

### Functions

```typescript
function loadMountAllowlist(): MountAllowlist | null
// Loads + validates ~/.config/nanoclaw/mount-allowlist.json, merging in default
// blocked patterns (.ssh, .aws, .env, id_rsa, ...). Returns null (and blocks all
// additional mounts) if missing/invalid. Result cached.

function _resetMountAllowlistCache(): void   // @internal (tests only) — clears the cache + load-error

function hostPathHasDisallowedColon(
  hostPath: string,
  platform?: NodeJS.Platform,
): boolean
// @internal-ish (exported so the Windows branch is testable). True if hostPath
// contains a colon other than a single leading Windows drive-letter colon
// (a colon could inject extra `-v host:container:mode` fields).

function validateMount(mount: AdditionalMount, isMain: boolean): MountValidationResult
// Full pipeline: type/colon/control-char checks -> container-path validation ->
// symlink-resolve host path -> blocked-pattern check -> allowed-root check ->
// readonly resolution (nonMainReadOnly + AllowedRoot.allowReadWrite).

function validateAdditionalMounts(
  mounts: AdditionalMount[],
  groupName: string,
  isMain: boolean,
): Array<{ hostPath: string; containerPath: string; readonly: boolean }>
// Validates each mount; returns only those allowed, with containerPath prefixed
// by /workspace/extra/. Rejected mounts are logged as warnings.

function generateAllowlistTemplate(): string  // Pretty-printed example allowlist JSON
```

---

## container-runner

`src/container-runner.ts` — Spawns the agent (in a container, or directly on the
host in `host` mode), streams its output, enforces timeouts, and writes IPC
snapshots.

### ContainerInput / ContainerOutput / AvailableGroup

```typescript
interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;  // injected via stdin at run time; never written to disk
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}
```

### runContainerAgent

Builds mounts, spawns the runtime (or host process), writes `ContainerInput`
(with secrets from `.env`) to stdin, and stream-parses
`---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` marker pairs. Each
parsed `ContainerOutput` invokes `onOutput`; activity resets a hard timeout
(`max(group timeout, IDLE_TIMEOUT + 30s)`). The returned promise resolves once
the process closes (the actual results are delivered via `onOutput`, so the
resolved value's `result` is typically `null`).

```typescript
async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput>
```

> In `host` mode there is **no** filesystem isolation: the additional-mount
> allowlist does not apply and the agent inherits the orchestrator's
> environment. Host mode requires `container/agent-runner/dist` to be built.

### writeTasksSnapshot

Writes `current_tasks.json` into the group's IPC dir. Main sees all tasks;
others only their own.

```typescript
function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void
```

### writeGroupsSnapshot

Writes `available_groups.json` into the group's IPC dir. Only main sees the
group list (non-main gets an empty array, since only main can activate groups).

```typescript
function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void
```

---

## group-queue

`src/group-queue.ts`

### GroupQueue

Concurrency controller. Serializes work per group (one active container per
group at a time) and caps the global active count at
`MAX_CONCURRENT_CONTAINERS`; over-limit work is parked in `waitingGroups` and
drained as slots free up. **Tasks take priority over message checks** both when
preempting an idle container and when draining. Message-check failures retry
with exponential backoff (`BASE_RETRY_MS = 5000`, `MAX_RETRIES = 5`).

```typescript
class GroupQueue {
  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void
  // Registers the callback that processes a group's pending messages.
  // Returns true on success; false triggers a backoff retry.

  enqueueMessageCheck(groupJid: string): void
  // Request a message-processing run. Coalesced/queued if the group is active
  // or the concurrency limit is reached.

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void
  // Queue a scheduled task. De-dupes by taskId. Preempts an idle container.

  registerProcess(
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder?: string,
  ): void
  // Associate the spawned process/container with the group (used by sendMessage/shutdown).

  notifyIdle(groupJid: string): void
  // Mark the container idle-waiting; if tasks are pending, close stdin to preempt it.

  sendMessage(groupJid: string, text: string): boolean
  // Deliver a follow-up message to an active (non-task) container via an IPC
  // input file. Returns false when there is no eligible active container.

  closeStdin(groupJid: string): void
  // Write a `_close` sentinel into the group's IPC input dir to wind the container down.

  async shutdown(gracePeriodMs: number): Promise<void>
  // Stop accepting work and detach (do NOT kill) active containers — they finish
  // via idle/hard timeout and self-remove (`--rm`).
}
```

---

## ipc

`src/ipc.ts` — File-based IPC watcher. Polls each group's IPC directory under
`DATA_DIR/ipc/<groupFolder>/{messages,tasks}` every `IPC_POLL_INTERVAL` ms. The
**source group identity is determined by the directory**, not the file
contents, which is the basis for all authorization. Malformed files are moved to
`DATA_DIR/ipc/errors/`.

### IpcDeps

```typescript
interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}
```

### Functions

```typescript
function startIpcWatcher(deps: IpcDeps): void   // Idempotent; starts the poll loop
function _resetIpcWatcherForTests(): void        // @internal (tests only)

async function processTaskIpc(
  data: { type: string; taskId?: string; prompt?: string; schedule_type?: string;
          schedule_value?: string; context_mode?: string; groupFolder?: string;
          chatJid?: string; targetJid?: string; jid?: string; name?: string;
          folder?: string; trigger?: string; requiresTrigger?: boolean;
          containerConfig?: RegisteredGroup['containerConfig'] },
  sourceGroup: string,  // verified identity (IPC directory name)
  isMain: boolean,      // verified (sourceGroup === MAIN_GROUP_FOLDER)
  deps: IpcDeps,
): Promise<void>
```

### IPC protocol & authorization

**Message files** (`messages/*.json`): `{ type: 'message', chatJid, text }`.
Sent only if the source is `main` **or** the target chat's registered group
folder equals `sourceGroup`; otherwise blocked.

**Task files** (`tasks/*.json`), dispatched by `processTaskIpc` on `data.type`:

| Type | Authorization | Effect |
|------|---------------|--------|
| `schedule_task` | non-main may only target its own folder | Computes `next_run` (cron/interval/once), creates task. `context_mode` defaults to `'group'` (only explicit `'isolated'` opts out). |
| `pause_task` | task's folder == source, or main | `status = 'paused'` |
| `resume_task` | task's folder == source, or main | `status = 'active'` |
| `cancel_task` | task's folder == source, or main | Deletes task |
| `refresh_groups` | main only | Forces metadata sync, rewrites groups snapshot |
| `register_group` | main only | Validates folder, rejects folder/JID hijack, registers group |

Unknown `type` values are logged and ignored.

---

## task-scheduler

`src/task-scheduler.ts` — Polls `getDueTasks()` every `SCHEDULER_POLL_INTERVAL`
ms and enqueues each due, still-active task onto the `GroupQueue`. Each task
runs the agent once (single-turn), forwards any streamed `result` to the chat,
then schedules a prompt container close (`TASK_CLOSE_DELAY_MS = 10000`).
Recurring tasks compute their next run; `once` tasks complete.

### SchedulerDependencies

```typescript
interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupJid: string,
    proc: ChildProcess,
    containerName: string,
    groupFolder: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}
```

### Functions

```typescript
function startSchedulerLoop(deps: SchedulerDependencies): void  // Idempotent
function _resetSchedulerLoopForTests(): void                     // @internal (tests only)
```

---

## router

`src/router.ts` — Inbound message formatting and outbound channel routing. Pure
functions.

```typescript
function escapeXml(s: string): string
// Escapes & < > " (returns '' for falsy input).

function formatMessages(messages: NewMessage[]): string
// Wraps messages in <messages>/<message sender=".." time=".."> XML for the prompt.

function stripInternalTags(text: string): string
// Removes <internal>...</internal> blocks and trims.

function formatOutbound(rawText: string): string
// Currently an alias for stripInternalTags — the outbound sanitization hook.

function findChannel(channels: Channel[], jid: string): Channel | undefined
// First channel whose ownsJid(jid) is true.
```

---

## channels/whatsapp

`src/channels/whatsapp.ts` — WhatsApp transport via `@whiskeysockets/baileys`,
implementing the [`Channel`](#types) interface.

### WhatsAppChannelOpts

```typescript
interface WhatsAppChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}
```

### WhatsAppChannel

```typescript
class WhatsAppChannel implements Channel {
  name = 'whatsapp';
  constructor(opts: WhatsAppChannelOpts)

  async connect(): Promise<void>          // Resolves on first 'open'; auto-reconnects (unless logged out)
  async sendMessage(jid: string, text: string): Promise<void>  // Queues if disconnected/on failure
  isConnected(): boolean
  ownsJid(jid: string): boolean           // true for *@g.us and *@s.whatsapp.net
  async disconnect(): Promise<void>
  async setTyping(jid: string, isTyping: boolean): Promise<void>  // presence: composing/paused
  async syncGroupMetadata(force?: boolean): Promise<void>  // 24h-cached unless force
}
```

Notes: emits chat metadata for every chat (group discovery) but delivers full
messages only for registered groups; prefixes outbound text with
`<ASSISTANT_NAME>:` unless `ASSISTANT_HAS_OWN_NUMBER`; translates `@lid` JIDs to
phone JIDs.

---

## index (entry)

`src/index.ts` — The orchestrator entry point: owns in-memory state, the message
loop, channel/queue/IPC/scheduler wiring, and graceful shutdown. Most of its
surface is internal; only two functions are exported (the second is test-only).

```typescript
function getAvailableGroups(): AvailableGroup[]
// All known group chats (excluding the __group_sync__ sentinel) annotated with
// isRegistered. Passed to the IPC watcher and groups snapshot.

function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void
// @internal — exported for testing; overwrites the in-memory registeredGroups map.
```
