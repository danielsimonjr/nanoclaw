# NanoClaw — Data Flow Documentation

**Last Updated**: 2026-05-31

---

## Table of Contents

1. [Overview](#overview)
2. [Inbound WhatsApp Message → Agent → Reply](#inbound-whatsapp-message--agent--reply)
3. [Filesystem IPC Round-Trip](#filesystem-ipc-round-trip)
4. [Scheduled Task Firing](#scheduled-task-firing)
5. [Host-Mode vs Container-Mode Execution](#host-mode-vs-container-mode-execution)
6. [Secrets Flow](#secrets-flow)

---

## Overview

NanoClaw is a single Node.js process (the **orchestrator**, `src/index.ts`) that connects to WhatsApp and routes messages to Claude Agent SDK sessions running inside Linux containers (or directly on the host). Each registered group gets its own isolated filesystem, session history, and IPC namespace. The orchestrator never runs Claude itself — it manages containers and coordinates the three subsystems that run concurrently:

```
┌────────────────────────────────────────────────────────────────┐
│  Orchestrator (src/index.ts)                                   │
│                                                                │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │  startMessage-   │  │ startScheduler │  │ startIpc-    │  │
│  │  Loop (polling)  │  │ Loop (polling) │  │ Watcher      │  │
│  └────────┬─────────┘  └───────┬────────┘  └──────┬───────┘  │
│           │                    │                   │           │
│           └────────────────────┴────────┬──────────┘           │
│                                         │                      │
│                              ┌──────────▼──────────┐           │
│                              │     GroupQueue      │           │
│                              │  (per-group serial, │           │
│                              │   global concurrency│           │
│                              │   cap)              │           │
│                              └──────────┬──────────┘           │
└─────────────────────────────────────────┼──────────────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  runContainerAgent /  │
                              │  runHostAgent         │
                              │  (container-runner.ts)│
                              └───────────────────────┘
```

The **SQLite database** (`src/db.ts`, `data/store/messages.db`) is the durable backbone: messages, sessions, registered groups, scheduled tasks, and router cursors all live there.

---

## Inbound WhatsApp Message → Agent → Reply

### Sequence Diagram

```mermaid
sequenceDiagram
    participant WA as WhatsApp<br/>(Baileys)
    participant CH as WhatsAppChannel<br/>(channels/whatsapp.ts)
    participant DB as SQLite<br/>(db.ts)
    participant ML as startMessageLoop<br/>(index.ts)
    participant GQ as GroupQueue<br/>(group-queue.ts)
    participant PG as processGroupMessages<br/>(index.ts)
    participant CR as runContainerAgent<br/>(container-runner.ts)
    participant CT as Container<br/>(agent-runner/index.ts)
    participant OUT as onOutput callback<br/>(index.ts)

    WA->>CH: messages.upsert event
    CH->>CH: translateJid (LID→phone)
    CH->>DB: storeMessage (registered groups only)
    CH->>DB: storeChatMetadata (all chats)

    loop every POLL_INTERVAL
        ML->>DB: getNewMessages(jids, lastTimestamp)
        DB-->>ML: {messages, newTimestamp}
        ML->>ML: advance lastTimestamp cursor, saveState()
        ML->>ML: deduplicate by group JID
        ML->>ML: check trigger pattern (non-main groups)

        alt container already active for group
            ML->>GQ: sendMessage(chatJid, formatted)
            GQ->>FS: write ipc/<group>/input/<ts>.json
        else no active container
            ML->>GQ: enqueueMessageCheck(chatJid)
        end
    end

    GQ->>PG: processGroupMessages(chatJid)
    PG->>DB: getMessagesSince(chatJid, lastAgentTimestamp)
    PG->>PG: advance lastAgentTimestamp cursor, saveState()
    PG->>CR: runContainerAgent(group, input, onProcess, onOutput)

    CR->>CR: buildVolumeMounts(group, isMain)
    CR->>CR: spawn container (docker/podman/container)
    CR->>CT: JSON.stringify(input) → stdin (includes secrets)
    CR->>CR: delete input.secrets from memory

    CT->>CT: readStdin() → parse ContainerInput
    CT->>CT: delete /tmp/input.json sentinel
    CT->>CT: query(SDK) with MessageStream
    CT-->>CR: stdout: OUTPUT_START...JSON...OUTPUT_END
    CR->>CR: stream-parse OUTPUT marker pairs
    CR->>OUT: onOutput({status, result, newSessionId})

    OUT->>CH: channel.sendMessage(chatJid, text)
    CH->>WA: sock.sendMessage (or outgoingQueue if disconnected)
    WA-->>WA: delivered to group

    CT->>CT: waitForIpcMessage() polls ipc/input/
    CT-->>CR: process exits (or idle _close sentinel)
    CR-->>PG: ContainerOutput {status: 'success'}
    PG-->>GQ: return true (success)
    GQ->>GQ: drainGroup (tasks first, then pending messages)
```

### Walk-Through

**1. Inbound message arrives** (`src/channels/whatsapp.ts`, `connectInternal`)

The Baileys socket fires `messages.upsert`. For every incoming message the channel:
- Translates LID JIDs to phone JIDs via `translateJid` (cached lookup, then Baileys `signalRepository`).
- Calls `opts.onChatMetadata` for every chat, writing to the `chats` table so unregistered groups still appear in discovery.
- For registered groups only, extracts text content and calls `opts.onMessage`, which calls `storeMessage` in `db.ts`.

**2. Message loop polls** (`src/index.ts`, `startMessageLoop`)

Every `POLL_INTERVAL` milliseconds the loop calls `getNewMessages(jids, lastTimestamp)`. This issues a single SQL query that returns only non-bot messages (`is_bot_message = 0`) newer than the cursor. The cursor (`lastTimestamp`) is advanced and saved to `router_state` before any group processing, so a crash between the cursor advance and processing is recovered by `recoverPendingMessages` on next startup.

Messages are grouped by JID. For non-main groups that require a trigger word, the batch is only acted on if at least one message matches `TRIGGER_PATTERN`. When a trigger is present, `getMessagesSince(chatJid, lastAgentTimestamp[chatJid])` pulls the full context window, not just the triggering batch.

If an active container already exists for the group, `queue.sendMessage` writes a JSON file to the group's `ipc/<group>/input/` directory. If no container is running, `queue.enqueueMessageCheck` is called.

**3. GroupQueue serializes per-group work** (`src/group-queue.ts`)

`GroupQueue` ensures at most one container runs per group at a time, and enforces a global `MAX_CONCURRENT_CONTAINERS` ceiling across all groups. `enqueueMessageCheck` either starts `runForGroup` immediately or sets `state.pendingMessages = true` and adds the group to `waitingGroups`. When a container finishes, `drainGroup` checks for pending tasks (higher priority) then pending messages, and `drainWaiting` unblocks groups that were at the concurrency limit.

**4. processGroupMessages runs the agent** (`src/index.ts`, `processGroupMessages`)

This function is the queue's `processMessagesFn`. It calls `getMessagesSince` (the authoritative context query using `lastAgentTimestamp`, not `lastTimestamp`), formats messages with `formatMessages`, advances `lastAgentTimestamp`, then calls `runAgent`. An idle timer (`IDLE_TIMEOUT`) starts after each streaming result; when it fires, `queue.closeStdin` writes a `_close` sentinel to `ipc/<group>/input/`. On agent error, the cursor is rolled back unless output has already been sent (to prevent duplicate messages on retry).

**5. Container is spawned and driven** (`src/container-runner.ts`, `runContainerAgent` → `driveAgentProcess`)

`buildVolumeMounts` constructs the bind-mount list, `buildContainerArgs` assembles the `docker run -i --rm --name ...` command, and `spawn` starts the process. `driveAgentProcess` is the shared driver for both container and host modes. It:
- Writes the serialized `ContainerInput` (with secrets) to stdin, then calls `proc.stdin.end()` and deletes `input.secrets` from memory.
- Streams stdout through a parse buffer looking for `---NANOCLAW_OUTPUT_START---` / `---NANOCLAW_OUTPUT_END---` marker pairs. Each complete pair is parsed as `ContainerOutput` JSON and forwarded to the `onOutput` callback.
- Resets a hard-kill timeout on each marker pair (not on stderr, which the SDK writes continuously).
- Writes a run log to `groups/<name>/logs/agent-<ts>.log` on process close.

**6. Agent produces streamed output** (`container/agent-runner/src/index.ts`)

Inside the container, `readStdin()` reads the full `ContainerInput`. Secrets are merged into `sdkEnv` (never into `process.env`). A `MessageStream` (async iterable) is constructed and the initial prompt is pushed into it. The Claude Agent SDK `query()` call iterates over messages; when a `result`-type message arrives, `writeOutput` prints the `OUTPUT_START/END`-wrapped JSON to stdout. After the query loop ends, the agent waits for the next IPC message or `_close` sentinel via `waitForIpcMessage()`, polling `ipc/input/` at 500ms intervals.

**7. Reply is sent** (`src/index.ts`, `processGroupMessages` streaming callback)

The `onOutput` callback in `processGroupMessages` strips `<internal>...</internal>` blocks from the result text and calls `channel.sendMessage(chatJid, text)`. In `WhatsAppChannel.sendMessage`, if the socket is connected the message goes out immediately via `sock.sendMessage`; if not, it is pushed to `outgoingQueue` and flushed by `flushOutgoingQueue` on reconnect.

---

## Filesystem IPC Round-Trip

This flow describes how a running agent sends messages or manages tasks back to the orchestrator. The transport is the shared IPC filesystem namespace under `DATA_DIR/ipc/<group>/`.

### Sequence Diagram

```mermaid
sequenceDiagram
    participant AG as Agent MCP server<br/>(ipc-mcp-stdio.ts)
    participant FS as Filesystem<br/>DATA_DIR/ipc/<group>/
    participant IW as startIpcWatcher<br/>(ipc.ts)
    participant DB as SQLite<br/>(db.ts)
    participant CH as Channel<br/>(channels/whatsapp.ts)

    AG->>AG: send_message tool called
    AG->>FS: atomic write: messages/<ts>-<rand>.json<br/>{type:"message", chatJid, text, groupFolder}

    AG->>AG: schedule_task tool called
    AG->>FS: atomic write: tasks/<ts>-<rand>.json<br/>{type:"schedule_task", prompt, schedule_type, ...}

    loop every IPC_POLL_INTERVAL
        IW->>FS: readdirSync(ipc/) → group folder names
        IW->>IW: identity = directory name (not from file contents)

        loop for each group folder
            IW->>FS: readdirSync(ipc/<group>/messages/)
            loop for each .json file
                IW->>IW: parse {type, chatJid, text}
                IW->>IW: authorization check:<br/>isMain || targetGroup.folder === sourceGroup
                alt authorized
                    IW->>CH: sendMessage(chatJid, text)
                else unauthorized
                    IW->>IW: log warn, consume file
                end
                IW->>FS: unlink(filePath)
            end

            IW->>FS: readdirSync(ipc/<group>/tasks/)
            loop for each .json file
                IW->>IW: processTaskIpc(data, sourceGroup, isMain)
                note over IW: schedule_task: validate schedule,<br/>createTask() in SQLite
                note over IW: pause/resume/cancel: auth check<br/>then updateTask/deleteTask
                note over IW: register_group: main-only,<br/>folder hijack guard
                IW->>DB: createTask / updateTask / deleteTask / setRegisteredGroup
                IW->>FS: unlink(filePath)
            end
        end
    end
```

### Walk-Through

**Identity is derived from directory, not file contents** (`src/ipc.ts`, `startIpcWatcher`)

The watcher scans `DATA_DIR/ipc/` (created at startup). Each subdirectory corresponds to one group's IPC namespace. The group's identity — including whether it is the main group — is determined entirely by the directory name, not by anything written inside the files. This is the key tamper-proofing mechanism: an agent cannot claim to be main by writing `isMain: true` in a message file.

**Atomic writes prevent partial reads** (`container/agent-runner/src/ipc-mcp-stdio.ts`, `writeIpcFile`)

The MCP server writes to a `.tmp` file first, then `fs.renameSync` to the final name. The watcher only sees complete files.

**Authorization rules** (`src/ipc.ts`, `startIpcWatcher` and `processTaskIpc`)

- *Messages*: allowed if `isMain` or the target group's `folder` equals the source directory name.
- *schedule_task*: non-main groups can only schedule for their own `targetJid`.
- *pause/resume/cancel_task*: non-main groups can only act on tasks where `task.group_folder === sourceGroup`.
- *register_group*: main-only. Includes a folder-hijack guard: if the requested folder is already owned by a different JID (or the JID already maps to a different folder), the request is rejected.
- *refresh_groups*: main-only.

**Malformed files are quarantined**, not retried. A file that fails JSON parsing is moved to `DATA_DIR/ipc/errors/<group>-<filename>` so the directory stays clean and does not loop.

**Follow-up messages to an active container** (`src/group-queue.ts`, `sendMessage`)

When the orchestrator's message loop detects a new message for a group that already has an active container, it calls `queue.sendMessage(chatJid, text)`. This writes a `{type:"message", text}` JSON file to `ipc/<group>/input/`. The running agent-runner polls `IPC_INPUT_DIR` every 500ms (`drainIpcInput`) and pushes new messages directly into the `MessageStream` that feeds the SDK query. A `_close` sentinel (`ipc/<group>/input/_close`) signals the agent to exit after its current query.

---

## Scheduled Task Firing

### Sequence Diagram

```mermaid
sequenceDiagram
    participant SL as startSchedulerLoop<br/>(task-scheduler.ts)
    participant DB as SQLite<br/>(db.ts)
    participant GQ as GroupQueue<br/>(group-queue.ts)
    participant RT as runTask<br/>(task-scheduler.ts)
    participant CR as runContainerAgent<br/>(container-runner.ts)
    participant CH as Channel

    loop every SCHEDULER_POLL_INTERVAL
        SL->>DB: getDueTasks()
        DB-->>SL: tasks where status='active' AND next_run <= now()

        loop for each due task
            SL->>DB: getTaskById(task.id)  [re-check status]
            alt status still active
                SL->>GQ: enqueueTask(chatJid, taskId, fn)
            end
        end
    end

    GQ->>RT: runTask(task, deps)
    RT->>DB: writeTasksSnapshot (for container to read)
    RT->>CR: runContainerAgent(group, {isScheduledTask:true, ...})
    CR->>CT: stdin: ContainerInput with task prompt
    CT-->>CR: stdout: OUTPUT markers
    CR->>RT: onOutput({result})
    RT->>CH: sendMessage(chatJid, result)
    RT->>RT: scheduleClose() after 10s
    GQ->>GQ: closeStdin → _close sentinel

    RT->>DB: logTaskRun(taskId, duration, status, result)
    RT->>DB: updateTaskAfterRun(taskId, nextRun)
    note over DB: cron/interval: nextRun computed<br/>once: status → 'completed'
```

### Walk-Through

**Scheduler loop** (`src/task-scheduler.ts`, `startSchedulerLoop`)

The loop runs every `SCHEDULER_POLL_INTERVAL` milliseconds. `getDueTasks()` issues a single SQL query:

```sql
SELECT * FROM scheduled_tasks
WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
ORDER BY next_run
```

For each due task, `getTaskById` re-checks the status in case it was paused or cancelled between the query and now. If still active, `deps.queue.enqueueTask(chatJid, taskId, fn)` is called.

**Task concurrency in GroupQueue** (`src/group-queue.ts`, `enqueueTask`)

Tasks use the same `GroupQueue` as message-triggered runs. If a container is already active for the group, the task is pushed to `state.pendingTasks`. If the active container is in `idleWaiting` state (agent finished its last query and is waiting), `closeStdin` is called immediately so the container exits and the task can start. Tasks are drained before pending messages in `drainGroup`.

**runTask executes the agent** (`src/task-scheduler.ts`, `runTask`)

The `ContainerInput` is constructed with `isScheduledTask: true`. The agent-runner prepends a `[SCHEDULED TASK]` header to the prompt so Claude knows it is not responding to a live user. `context_mode` controls whether the group's current session ID is passed (`group` mode) or a fresh session is used (`isolated` mode).

A `TASK_CLOSE_DELAY_MS` (10 s) close timer is scheduled after the first result arrives; this is shorter than the full `IDLE_TIMEOUT` (default 30 min) because tasks are single-turn. After the agent exits, `logTaskRun` records the outcome and `updateTaskAfterRun` sets the next `next_run` timestamp (cron and interval tasks) or transitions the status to `completed` (once tasks).

---

## Host-Mode vs Container-Mode Execution

Both modes share `driveAgentProcess` for identical protocol, timeout, and logging behavior. The divergence is in how the agent process is spawned.

### Divergence Diagram

```mermaid
flowchart TD
    Start([runContainerAgent called]) --> Check{isHostMode?}

    Check -- "CONTAINER_RUNTIME=host" --> Host[runHostAgent]
    Check -- "docker / podman / container" --> Container[container path]

    Host --> HEnv["Build env vars:\nNANOCLAW_GROUP_DIR\nNANOCLAW_GLOBAL_DIR\nNANOCLAW_IPC_DIR\nNANOCLAW_EXTRA_DIR\nHOME / USERPROFILE\nCLAUDE_CONFIG_DIR"]
    Host --> HSpawn["spawn(node, [dist/index.js])\ncwd=groupDir\nno bind mounts\nno sandbox"]
    Host --> HNote["No filesystem isolation.\nAdditional-mount allowlist\ndoes not apply.\nUses shared prebuilt agent-runner."]

    Container --> CMounts["buildVolumeMounts(group, isMain)\n→ VolumeMount[]"]
    CMounts --> CArgs["buildContainerArgs(mounts, containerName)\n→ docker run -i --rm --name ..."]
    CArgs --> CSpawn["spawn(docker/podman, containerArgs)\nprocess isolated\nbind mounts enforced"]

    HSpawn --> Drive[driveAgentProcess]
    CSpawn --> Drive

    Drive --> Stdin["write JSON(ContainerInput) → stdin\ndelete input.secrets"]
    Drive --> Parse["stream-parse OUTPUT markers"]
    Drive --> Timeout["hard kill timeout\n(max of CONTAINER_TIMEOUT,\nIDLE_TIMEOUT + 30s)"]
    Drive --> Log["writeRunLog on close"]
```

### Walk-Through

**Container mode** (`src/container-runner.ts`, `runContainerAgent`)

`buildVolumeMounts` constructs bind mounts based on the group's role:
- *Main group*: project root read-only at `/workspace/project`, plus its own group folder read-write at `/workspace/group`.
- *Other groups*: only their group folder at `/workspace/group`, plus an optional read-only global memory directory at `/workspace/global`.
- *All groups*: per-group Claude sessions at `/home/node/.claude` (isolated by group to prevent cross-group session access), IPC namespace at `/workspace/ipc`, and a per-group copy of the agent-runner source at `/app/src` (refreshed from upstream when changed).
- *Additional mounts* from `group.containerConfig.additionalMounts` are validated through `validateAdditionalMounts` in `src/mount-security.ts` before being included. The allowlist lives on the host filesystem, outside the container's write reach.

`buildContainerArgs` passes `TZ`, `--user` (to match host UID for bind-mount ownership), and volume flags. The container is started with `docker run -i --rm --name nanoclaw-<folder>-<ts>`.

**Host mode** (`src/container-runner.ts`, `runHostAgent`)

`isHostMode()` returns true when `CONTAINER_RUNTIME=host`. Instead of spawning a container, `runHostAgent` calls `spawn(process.execPath, [agentEntry])` with environment variables that map to the same logical paths the container would see via bind mounts. `CLAUDE_CONFIG_DIR` and `HOME`/`USERPROFILE` are pointed at the per-group sessions directory for Claude config isolation. The additional-mount allowlist does not apply and no filesystem boundary exists between the agent and the host.

**Shared driveAgentProcess** (`src/container-runner.ts`, `driveAgentProcess`)

Both paths call `driveAgentProcess` with a `stop` function (container: `docker stop` with `SIGKILL` fallback; host: `SIGTERM` then `SIGKILL`). The hard timeout is `max(configTimeout, IDLE_TIMEOUT + 30_000)` to ensure the graceful `_close` path can complete before force-stopping.

---

## Secrets Flow

API credentials (`ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`) are required by the Claude Agent SDK but must not be visible to Bash subprocesses, mounted as files, or logged.

### Flow Diagram

```mermaid
flowchart LR
    ENV[".env file\n(host filesystem)"] --> RE["readEnvFile()\n(src/env.ts)"]
    RE --> RS["readSecrets()\n(container-runner.ts)\nreturns Record<string,string>"]

    RS --> DIS["driveAgentProcess:\ninput.secrets = readSecrets()\nproc.stdin.write(JSON.stringify(input))\nproc.stdin.end()\ndelete input.secrets"]

    DIS --> CT["Container stdin\n(in-flight only)"]

    CT --> AR["agent-runner main():\nreadStdin() → containerInput\nsdkEnv = {...process.env, ...secrets}\ndelete containerInput.secrets\nfs.unlinkSync('/tmp/input.json')"]

    AR --> SDK["SDK query()\nreceives sdkEnv\n(secrets in memory only)"]

    SDK --> HOOK["PreToolUse Bash hook\ncreates sanitizeBashHook:\nunset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN\nbefore every Bash command"]

    HOOK --> BASH["Bash subprocess\n(cannot see secrets)"]

    style ENV fill:#f9f,stroke:#333
    style DIS fill:#ffd,stroke:#333
    style HOOK fill:#dff,stroke:#333
    style BASH fill:#dfd,stroke:#333
```

### Walk-Through

**Reading secrets** (`src/container-runner.ts`, `readSecrets`)

`readSecrets()` calls `readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'])` which reads the `.env` file on the host. The values are never placed in `process.env` of the orchestrator.

**Passing secrets via stdin** (`src/container-runner.ts`, `driveAgentProcess`)

Immediately before writing to stdin, `input.secrets = readSecrets()` is assigned. The entire `ContainerInput` JSON (including secrets) is written to `proc.stdin` and the pipe is closed. `delete input.secrets` runs synchronously after `proc.stdin.end()` so the object does not retain secrets in the orchestrator's heap. Secrets are never written to the bind-mounted filesystem, passed as environment variables to `docker run`, or included in run logs (the log writer uses the `input` object after the `delete`).

**In-container handling** (`container/agent-runner/src/index.ts`, `main`)

After `readStdin()` parses the input, secrets are merged into a local `sdkEnv` object (`sdkEnv[key] = value` for each secret). The `containerInput.secrets` field is then deleted. `fs.unlinkSync('/tmp/input.json')` removes a temp file the container entrypoint may have written. The SDK is called with `env: sdkEnv`; the main `process.env` is never modified, so Bash subprocesses spawned by the SDK's shell tool inherit a clean environment.

**Bash hook strips secrets at command time** (`container/agent-runner/src/index.ts`, `createSanitizeBashHook`)

A `PreToolUse` hook registered on the `Bash` matcher prepends `unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null;` to every Bash command before execution. This is a belt-and-suspenders measure for any code path that might leak credentials into a subprocess environment.
