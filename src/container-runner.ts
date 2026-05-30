/**
 * Container Runner for NanoClaw
 * Spawns agent execution in containers and handles IPC
 */
import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import { syncDirIfChanged } from './fs-sync.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  bindMountArgs,
  getContainerSpawnCommand,
  isHostMode,
  stopContainer,
} from './container-runtime.js';
import { validateAdditionalMounts } from './mount-security.js';
import { RegisteredGroup } from './types.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    // Main gets the project root read-only. Writable paths the agent needs
    // (group folder, IPC, .claude/) are mounted separately below.
    // Read-only prevents the agent from modifying host application code
    // (src/, dist/, package.json, etc.) which would bypass the sandbox
    // entirely on next restart.
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Main also gets its group folder as the working directory
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Other groups only get their own folder
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory directory (read-only for non-main)
    // Only directory mounts are supported, not file mounts
    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  // Per-group Claude sessions directory (isolated from other groups)
  // Each group gets their own .claude/ to prevent cross-group session access
  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          env: {
            // Enable agent swarms (subagent orchestration)
            // https://code.claude.com/docs/en/agent-teams#orchestrate-teams-of-claude-code-sessions
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
            // Load CLAUDE.md from additional mounted directories
            // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
            CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
            // Enable Claude's memory feature (persists user preferences between sessions)
            // https://code.claude.com/docs/en/memory#manage-auto-memory
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  }

  // Sync skills from container/skills/ into each group's .claude/skills/
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  // Per-group IPC namespace: each group gets its own IPC directory
  // This prevents cross-group privilege escalation via IPC
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  // Copy agent-runner source into a per-group writable location so agents
  // can customize it (add tools, change behavior) without affecting other
  // groups. Recompiled on container startup via entrypoint.sh. The copy is
  // refreshed whenever the upstream source changes (e.g. after /update) so
  // bug fixes and new tools propagate to existing groups.
  const agentRunnerSrc = path.join(
    projectRoot,
    'container',
    'agent-runner',
    'src',
  );
  const groupAgentRunnerDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'agent-runner-src',
  );
  syncDirIfChanged(agentRunnerSrc, groupAgentRunnerDir);
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: false,
  });

  // Additional mounts validated against external allowlist (tamper-proof from containers)
  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      isMain,
    );
    mounts.push(...validatedMounts);
  }

  return mounts;
}

/**
 * Read allowed secrets from .env for passing to the container via stdin.
 * Secrets are never written to disk or mounted as files.
 */
function readSecrets(): Record<string, string> {
  return readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
}

/** Upper bound (24h) on a group's configurable agent timeout. */
const MAX_AGENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve a group's agent timeout, clamping the (registration-supplied)
 * containerConfig.timeout to a sane, finite, positive value so a malformed or
 * hostile value cannot pin a container/concurrency slot indefinitely.
 */
function resolveAgentTimeout(group: RegisteredGroup): number {
  const configured = group.containerConfig?.timeout;
  if (
    typeof configured !== 'number' ||
    !Number.isFinite(configured) ||
    configured <= 0
  ) {
    return CONTAINER_TIMEOUT;
  }
  return Math.min(configured, MAX_AGENT_TIMEOUT_MS);
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Pass host timezone so container's local time matches the user's
  args.push('-e', `TZ=${TIMEZONE}`);

  // Run as host user so bind-mounted files are accessible.
  // Skip when running as root (uid 0), as the container's node user (uid 1000),
  // or when getuid is unavailable (native Windows without WSL).
  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  for (const mount of mounts) {
    args.push(
      ...bindMountArgs(mount.hostPath, mount.containerPath, mount.readonly),
    );
  }

  args.push(CONTAINER_IMAGE);

  return args;
}

interface AgentProcessConfig {
  proc: ChildProcess;
  group: RegisteredGroup;
  input: ContainerInput;
  startTime: number;
  logsDir: string;
  /** Short identifier for logs (container name or `host-<folder>`). */
  label: string;
  /** Streamed-result callback (invoked once per OUTPUT marker pair). */
  onOutput: (output: ContainerOutput) => Promise<void>;
  /** Graceful stop on hard timeout (e.g. `docker stop`, or SIGTERM+SIGKILL). */
  stop: () => void;
  /** Extra lines (args/mounts or command/cwd) for verbose/error run logs. */
  detail: string[];
}

/**
 * Drive a spawned agent process: write the input (with secrets) to stdin,
 * stream-parse OUTPUT markers, enforce the idle/hard timeout, write a run log,
 * and resolve once the process closes. Shared by the container and host runners
 * so both modes have identical protocol/timeout/logging behavior.
 */
function driveAgentProcess(cfg: AgentProcessConfig): Promise<ContainerOutput> {
  const { proc, group, input, startTime, logsDir, label, onOutput, stop } = cfg;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let hadStreamingOutput = false;
    let timedOut = false;

    // Pass secrets via stdin (never written to disk or mounted as files).
    input.secrets = readSecrets();
    proc.stdin?.write(JSON.stringify(input));
    proc.stdin?.end();
    delete input.secrets;

    const configTimeout = resolveAgentTimeout(group);
    // Grace period: the hard kill must outlast the IDLE_TIMEOUT _close path so a
    // graceful shutdown can complete before the process is force-stopped.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);
    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, label }, 'Agent timeout, stopping');
      stop();
    };
    let timeout = setTimeout(killOnTimeout, timeoutMs);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();

      // Accumulate (bounded) for the run log.
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Agent stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse OUTPUT_START/END marker pairs as they arrive.
      parseBuffer += chunk;
      let startIdx: number;
      while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
        const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
        if (endIdx === -1) break; // Incomplete pair, wait for more data.
        const jsonStr = parseBuffer
          .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
          .trim();
        parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);
        try {
          const parsed: ContainerOutput = JSON.parse(jsonStr);
          if (parsed.newSessionId) newSessionId = parsed.newSessionId;
          hadStreamingOutput = true;
          resetTimeout(); // Activity resets the hard timeout.
          // Call onOutput for every marker (including null results) so idle
          // timers start even for "silent" query completions.
          outputChain = outputChain
            .then(() => onOutput(parsed))
            .catch((err) =>
              logger.error(
                { group: group.name, err },
                'onOutput handler failed',
              ),
            );
        } catch (err) {
          logger.warn(
            { group: group.name, error: err },
            'Failed to parse streamed output chunk',
          );
        }
      }
    });

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      for (const line of chunk.trim().split('\n')) {
        if (line) logger.debug({ agent: label }, line);
      }
      // Don't reset the timeout on stderr — the SDK writes debug logs
      // continuously; only real OUTPUT markers count as activity.
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Agent stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    const writeRunLog = (code: number | null): void => {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const verbose =
          process.env.LOG_LEVEL === 'debug' ||
          process.env.LOG_LEVEL === 'trace';
        const lines = [
          `=== Agent Run Log${timedOut ? ' (TIMEOUT)' : ''} ===`,
          `Timestamp: ${new Date().toISOString()}`,
          `Group: ${group.name}`,
          `Label: ${label}`,
          `IsMain: ${input.isMain}`,
          `Duration: ${Date.now() - startTime}ms`,
          `Exit Code: ${code}`,
          `Timed Out: ${timedOut}`,
          `Stdout Truncated: ${stdoutTruncated}`,
          `Stderr Truncated: ${stderrTruncated}`,
          ``,
        ];
        if (verbose || code !== 0 || timedOut) {
          lines.push(
            `=== Input ===`,
            JSON.stringify(input, null, 2),
            ``,
            ...cfg.detail,
            ``,
            `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
            stderr,
            ``,
            `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
            stdout,
          );
        } else {
          lines.push(
            `Prompt length: ${input.prompt.length} chars`,
            `Session ID: ${input.sessionId || 'new'}`,
          );
        }
        fs.writeFileSync(
          path.join(logsDir, `agent-${ts}.log`),
          lines.join('\n'),
        );
      } catch (err) {
        logger.warn(
          { group: group.name, err },
          'Failed to write agent run log',
        );
      }
    };

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      writeRunLog(code);

      if (timedOut) {
        // Timeout after output = idle cleanup (the agent already responded),
        // not a failure.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, label, duration, code },
            'Agent timed out after output (idle cleanup)',
          );
          outputChain.then(() =>
            resolve({ status: 'success', result: null, newSessionId }),
          );
          return;
        }
        logger.error(
          { group: group.name, label, duration, code },
          'Agent timed out with no output',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Agent timed out after ${configTimeout}ms`,
        });
        return;
      }

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            label,
            code,
            duration,
            stderr: stderr.slice(-500),
          },
          'Agent exited with error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Agent exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      // Success: wait for the streamed-output chain to settle, then signal
      // completion (results were already delivered via onOutput).
      outputChain.then(() => {
        logger.info(
          { group: group.name, label, duration, newSessionId },
          'Agent completed',
        );
        resolve({ status: 'success', result: null, newSessionId });
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logger.error(
        { group: group.name, label, error: err },
        'Agent spawn error',
      );
      resolve({
        status: 'error',
        result: null,
        error: `Agent spawn error: ${err.message}`,
      });
    });
  });
}

/**
 * Run the agent directly on the host with no container sandbox
 * (CONTAINER_RUNTIME=host). The agent-runner is executed with `node`; the
 * directories bind-mounted under /workspace inside a container are passed as
 * NANOCLAW_* env vars instead, and per-group Claude config is isolated via the
 * home dir / CLAUDE_CONFIG_DIR.
 *
 * NOTE: there is no filesystem isolation in this mode — the additional-mount
 * allowlist does not apply, and the agent inherits the orchestrator's
 * environment. Host mode runs the shared, prebuilt agent-runner
 * (container/agent-runner/dist) for all groups; per-group agent-runner *source*
 * customization (a container-only feature) is intentionally not applied here.
 */
function runHostAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  // Reuse the container mount builder purely for its directory/settings/skills
  // setup side effects; the returned mount list is not needed on the host.
  buildVolumeMounts(group, input.isMain);

  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  const groupIpcDir = resolveGroupIpcPath(group.folder);
  const globalDir = path.join(GROUPS_DIR, 'global');
  const extraDir = path.join(DATA_DIR, 'sessions', group.folder, 'extra');
  fs.mkdirSync(extraDir, { recursive: true });

  const agentEntry = path.join(
    process.cwd(),
    'container',
    'agent-runner',
    'dist',
    'index.js',
  );
  if (!fs.existsSync(agentEntry)) {
    return Promise.resolve({
      status: 'error',
      result: null,
      error:
        `Host mode requires the agent-runner to be built first: ` +
        `cd container/agent-runner && npm install && npm run build (missing ${agentEntry})`,
    });
  }

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  // Per-group Claude config isolation: point the home dir at the parent of the
  // group's .claude so `~/.claude` resolves to groupSessionsDir. On Windows the
  // home dir comes from USERPROFILE (HOME is ignored), and CLAUDE_CONFIG_DIR is
  // a belt-and-suspenders override that works regardless of platform.
  const groupHome = path.dirname(groupSessionsDir);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TZ: TIMEZONE,
    NANOCLAW_GROUP_DIR: groupDir,
    NANOCLAW_GLOBAL_DIR: globalDir,
    NANOCLAW_EXTRA_DIR: extraDir,
    NANOCLAW_IPC_DIR: groupIpcDir,
    HOME: groupHome,
    USERPROFILE: groupHome,
    CLAUDE_CONFIG_DIR: groupSessionsDir,
  };

  const label = `host-${group.folder}`;
  logger.info(
    { group: group.name, label, isMain: input.isMain },
    'Spawning host agent (no container sandbox)',
  );

  const proc = spawn(process.execPath, [agentEntry], {
    cwd: groupDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  onProcess(proc, label);

  const stop = () => {
    proc.kill('SIGTERM');
    // Force-kill if SIGTERM is ignored; unref so this timer never keeps the
    // event loop alive after the process has already exited.
    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already exited */
      }
    }, 5000);
    killTimer.unref?.();
  };

  return driveAgentProcess({
    proc,
    group,
    input,
    startTime,
    logsDir,
    label,
    onOutput,
    stop,
    detail: [
      `=== Command ===`,
      `${process.execPath} ${agentEntry}`,
      ``,
      `=== Cwd ===`,
      groupDir,
    ],
  });
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  // No container runtime: run the agent directly on the host (no sandbox).
  if (isHostMode()) {
    return runHostAgent(group, input, onProcess, onOutput);
  }

  const startTime = Date.now();
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, input.isMain);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );
  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      isMain: input.isMain,
    },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const container = spawn(getContainerSpawnCommand(), containerArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  onProcess(container, containerName);

  const stop = () => {
    exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
      if (err) {
        logger.warn(
          { group: group.name, containerName, err },
          'Graceful stop failed, force killing',
        );
        container.kill('SIGKILL');
      }
    });
  };

  return driveAgentProcess({
    proc: container,
    group,
    input,
    startTime,
    logsDir,
    label: containerName,
    onOutput,
    stop,
    detail: [
      `=== Container Args ===`,
      containerArgs.join(' '),
      ``,
      `=== Mounts ===`,
      mounts
        .map(
          (m) =>
            `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
        )
        .join('\n'),
    ],
  });
}

export function writeTasksSnapshot(
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
): void {
  // Write filtered tasks to the group's IPC directory
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all tasks, others only see their own
  const filteredTasks = isMain
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

/**
 * Write available groups snapshot for the container to read.
 * Only main group can see all available groups (for activation).
 * Non-main groups only see their own registration status.
 */
export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  // Main sees all groups; others see nothing (they can't activate groups)
  const visibleGroups = isMain ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
