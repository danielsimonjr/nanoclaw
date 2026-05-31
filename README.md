<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  My personal Claude assistant that runs securely in containers. Lightweight and built to be understood and customized for your own needs.
</p>

<p align="center">
  <a href="https://nanoclaw.dev">nanoclaw.dev</a>&nbsp; • &nbsp;
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="https://discord.gg/VDdww8qS42"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

**New:** First AI assistant to support [Agent Swarms](https://code.claude.com/docs/en/agent-teams). Spin up teams of agents that collaborate in your chat.

## Why I Built This

[OpenClaw](https://github.com/openclaw/openclaw) is an impressive project with a great vision. But I can't sleep well running software I don't understand with access to my life. OpenClaw has 52+ modules, 8 config management files, 45+ dependencies, and abstractions for 15 channel providers. Security is application-level (allowlists, pairing codes) rather than OS isolation. Everything runs in one Node process with shared memory.

NanoClaw gives you the same core functionality in a codebase you can understand in 8 minutes. One process. A handful of files. Agents run in actual Linux containers with filesystem isolation, not behind permission checks.

## Quick Start

```bash
git clone https://github.com/qwibitai/nanoclaw.git
cd nanoclaw
claude
```

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup, service configuration.

## Philosophy

**Small enough to understand.** One process, a few source files. No microservices, no message queues, no abstraction layers. Have Claude Code walk you through it.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker). They can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for one user.** This isn't a framework. It's working software that fits my exact needs. You fork it and have Claude Code make it match your exact needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that this is safe.

**AI-native.** No installation wizard; Claude Code guides setup. No monitoring dashboard; ask Claude what's happening. No debugging tools; describe the problem, Claude fixes it.

**Skills over features.** Contributors shouldn't add features (e.g. support for Telegram) to the codebase. Instead, they contribute [claude code skills](https://code.claude.com/docs/en/skills) like `/add-telegram` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** This runs on Claude Agent SDK, which means you're running Claude Code directly. The harness matters. A bad harness makes even smart models seem dumb, a good harness gives them superpowers. Claude Code is (IMO) the best harness available.

## What It Supports

- **WhatsApp I/O** - Message Claude from your phone
- **Isolated group context** - Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted
- **Main channel** - Your private channel (self-chat) for admin control; every other group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content
- **Container isolation** - Agents sandboxed in Apple Container (macOS) or Docker/Podman (macOS/Linux/Windows)
- **Cross-platform** - Runs on macOS, Linux, and natively on Windows 10/11. Agents run in Linux containers (via Docker Desktop's WSL2 backend on Windows), or directly on the host with no container at all via `CONTAINER_RUNTIME=host`
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks (first personal AI assistant to support this)
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am (has access to my Obsidian vault folder)
@Andy review the git history for the past week each Friday and update the README if there's drift
@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your self-chat), you can manage groups and tasks:
```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Customizing

There are no configuration files to learn. Just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Updating

Pull the latest NanoClaw changes into your fork:

```bash
claude
```

Then run `/update`. Claude Code fetches upstream, previews changes, merges with your customizations, runs migrations, and verifies the result.

## Contributing

**Don't add features. Add skills.**

If you want to add Telegram support, don't create a PR that adds Telegram alongside WhatsApp. Instead, contribute a skill file (`.claude/skills/add-telegram/SKILL.md`) that teaches Claude Code how to transform a NanoClaw installation to use Telegram.

Users then run `/add-telegram` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd like to see:

**Communication Channels**
- `/add-slack` - Add Slack

**Platform Support**
- Windows 10/11 runs natively (Docker Desktop + WSL2 backend) or inside a WSL2 distro — both supported by `/setup`

**Session Management**
- `/add-clear` - Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session). Requires figuring out how to trigger compaction programmatically via the Claude Agent SDK.

## Requirements

- macOS, Linux, or Windows 10/11 (Windows 10 requires 64-bit version 2004 / build 19041 or later for the Docker Desktop WSL2 backend)
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- A container runtime (optional): [Docker](https://docker.com/products/docker-desktop), [Podman](https://podman.io/), or [Apple Container](https://github.com/apple/container) (macOS)

Docker is **optional**. The container runtime is chosen with the
`CONTAINER_RUNTIME` environment variable:

| `CONTAINER_RUNTIME` | Behavior |
|---------------------|----------|
| `auto` (default)    | Use the first available of docker, podman, container |
| `docker` / `podman` / `container` | Use that runtime explicitly |
| `host`              | Run the agent directly on the host — **no container, no filesystem isolation** |

`host` mode requires the agent-runner to be built once — run
`npm run build:agent` from the project root — and trades the container sandbox
away: the additional-mount allowlist no longer applies, the agent can access the
host filesystem, and it inherits the orchestrator's environment variables. Use
it only where you accept that. This is the way to run on Windows without Docker:
set `CONTAINER_RUNTIME=host`, build the agent-runner, and the agent runs as a
native Windows process — no WSL2 or Docker Desktop required.

On Windows 10/11, the orchestrator runs as a native Node.js process. By default
agents run in Linux containers via Docker Desktop's WSL2 backend — enable file
sharing for the drive holding the project — but with `CONTAINER_RUNTIME=host`
the agents also run natively on Windows with no container at all. (The
orchestrator and setup are keyed purely on the `win32` platform, so Windows 10
and 11 behave identically; the Docker path on Windows 10 just needs build
19041+.) Setup registers a logon Scheduled Task
(`schtasks`) instead of launchd/systemd. `better-sqlite3` ships prebuilt
binaries for Windows x64, so `npm install` works out of the box; on
unusual setups without a prebuild (e.g. arm64) install the
[Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) so
the native module can compile.

## Architecture

```
WhatsApp (baileys) --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. Agents execute in isolated Linux containers with mounted directories. Per-group message queue with concurrency control. IPC via filesystem.

Key files:
- `src/index.ts` - Orchestrator: state, message loop, agent invocation
- `src/channels/whatsapp.ts` - WhatsApp connection, auth, send/receive
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/container-runner.ts` - Spawns streaming agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `groups/*/CLAUDE.md` - Per-group memory

### Architecture documentation

In-depth, generated-and-authored architecture docs live in [`docs/architecture/`](docs/architecture/):

| Document | What it covers |
|----------|----------------|
| [OVERVIEW.md](docs/architecture/OVERVIEW.md) | High-level tour: capabilities, directory layout, data model, getting started, env vars |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System architecture, component layers, data model, key design decisions, security model |
| [COMPONENTS.md](docs/architecture/COMPONENTS.md) | Per-file responsibilities, exports, and collaborators |
| [API.md](docs/architecture/API.md) | Exported `src/` surface with TypeScript signatures and the filesystem IPC protocol |
| [DATAFLOW.md](docs/architecture/DATAFLOW.md) | End-to-end flows (message → container → reply, IPC round-trip, scheduling, secrets) with diagrams |
| [TEST_COVERAGE.md](docs/architecture/TEST_COVERAGE.md) | Per-suite breakdown of what the tests verify |
| [DEPENDENCY_GRAPH.md](docs/architecture/DEPENDENCY_GRAPH.md) | Full import/export graph, module map, circular-dependency analysis |

The dependency and coverage reports are generated by [`tools/create-dependency-graph`](tools/create-dependency-graph/); regenerate them with:

```bash
npx tsx tools/create-dependency-graph/create-dependency-graph.ts --root="$(pwd)" --include-tests
```

### Testing

```bash
npm test          # run the full Vitest suite
npm run typecheck # tsc --noEmit (src + setup) and the agent-runner
```

The suite is **458 tests across 42 files** covering the orchestrator, data layer, container/host runtimes, IPC authorization, mount security, scheduler, and cross-platform setup. The dependency tool reports **94.1% file-level coverage** of `src/` (16 of 17 files have tests; only `src/whatsapp-auth.ts`, an interactive one-shot setup script, is uncovered by design). See [TEST_COVERAGE.md](docs/architecture/TEST_COVERAGE.md) for the per-suite detail.

## FAQ

**Why WhatsApp and not Telegram/Signal/etc?**

Because I use WhatsApp. Fork it and run a skill to change it. That's the whole point.

**Why Docker?**

Docker is the default because it's cross-platform and mature, but it's optional. Set `CONTAINER_RUNTIME=podman` (or `container` for Apple Container) to use a different runtime, or `CONTAINER_RUNTIME=host` to run with no container at all. On macOS you can also switch to Apple Container via `/convert-to-apple-container`.

**Can I run without a container runtime?**

Yes — set `CONTAINER_RUNTIME=host` (works on macOS, Linux, and natively on Windows 10/11 with no Docker or WSL2). The agent then runs as a normal host process with the workspace directories passed via env vars. This removes the sandbox: agents get host filesystem access and the additional-mount allowlist no longer applies, so only enable it in environments where that's acceptable. Build the agent-runner first with `npm run build:agent`.

**Can I run this on Linux?**

Yes. Docker is the default runtime and works on both macOS and Linux. Just run `/setup`.

**Can I run this on Windows 10 or 11?**

Yes, natively on both — no WSL shell required for the orchestrator. The code
branches only on the `win32` platform, so Windows 10 and 11 are treated
identically. Install Docker Desktop with the WSL2 backend (this is what actually
runs the Linux agent containers; Windows 10 needs 64-bit build 19041+) and
enable file sharing for your project's drive, then run `/setup`. NanoClaw
detects Windows, registers a logon Scheduled Task via `schtasks`, and writes a
`start-nanoclaw.cmd` launcher. You can still run it inside a WSL2 Linux distro if
you prefer (it detects as Linux in that case), or set `CONTAINER_RUNTIME=host`
to run with no container at all.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model. (The isolation guarantees apply to the container runtimes; `CONTAINER_RUNTIME=host` opts out of the sandbox entirely.)

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize it to so that the code matches exactly what they want rather than configuring a generic system. If you like having config files, tell Claude to add them.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach.

**Why isn't the setup working for me?**

I don't know. Run `claude`, then run `/debug`. If claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Security fixes, bug fixes, and clear improvements to the base configuration. That's it.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VDdww8qS42).

## License

MIT
