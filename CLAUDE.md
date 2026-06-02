# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions. In-depth, graph-backed architecture docs live in [docs/architecture/](docs/architecture/) (regenerate the dependency/coverage reports with `npx tsx tools/create-dependency-graph/create-dependency-graph.ts --include-tests`).

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite ops; messages use a `(timestamp,id)` keyset cursor (`buildMessageCursor`) |
| `src/container-runtime.ts` | Runtime abstraction (docker/podman/container/host), orphan cleanup |
| `container/agent-runner/src/index.ts` | In-container agent runner (Claude Agent SDK driver) |
| `container/agent-runner/src/ipc-mcp-stdio.ts` | Agent-side MCP server (send_message, schedule_task, etc.) |
| `skills-engine/` | Skill apply/update/rebase engine (git-based patches via `git-utils.ts`) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser/SKILL.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run orchestrator with hot reload (tsx src/index.ts)
npm run build        # Compile orchestrator TypeScript (tsc)
npm run build:agent  # Build the in-container agent-runner (npm ci + build in container/agent-runner)
npm test             # Run vitest (src/, setup/, skills-engine/)
npm run typecheck    # Typecheck src + setup; typecheck:agent for the agent-runner
./container/build.sh # Rebuild agent container image (macOS/Linux/WSL)
container\build.cmd  # Rebuild agent container image (native Windows)
```

Container runtime is selected via `CONTAINER_RUNTIME` (`auto` default, or `docker`/`podman`/`container`/`host`). `host` runs the agent without a sandbox and requires the agent-runner to be built first via `npm run build:agent`. Runtime abstraction lives in `src/container-runtime.ts`.

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw

# Windows 10/11 (Scheduled Task, runs at logon)
schtasks /Run /TN NanoClaw      # start now
schtasks /End /TN NanoClaw      # stop
schtasks /Query /TN NanoClaw    # status
# Orchestrator runs natively; agents run in Linux containers via Docker Desktop (WSL2 backend).
```

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh` (or `container\build.cmd` on native Windows).
