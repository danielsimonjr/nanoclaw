/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 *
 * The runtime is selected via the CONTAINER_RUNTIME environment variable:
 *   - `auto` (default): use the first available of docker, podman, container (Apple)
 *   - `docker` | `podman` | `container`: use that container runtime explicitly
 *   - `host`: run the agent directly on the host with NO container/sandbox
 *
 * Docker is therefore optional: any compatible container runtime works, and a
 * sandbox-free host mode is available for environments without one.
 */
import { execSync } from 'child_process';

import { logger } from './logger.js';

export type RuntimeKind = 'container' | 'host';

/** Container runtime binaries probed (in order) when CONTAINER_RUNTIME=auto. */
const AUTO_DETECT_BINS = ['docker', 'podman', 'container'];

/** Container runtimes that may be selected explicitly by name. */
const KNOWN_CONTAINER_BINS = new Set(['docker', 'podman', 'container']);

export interface ResolvedRuntime {
  kind: RuntimeKind;
  /** Runtime binary for container kinds; null for host or when none was found. */
  bin: string | null;
}

/**
 * Pure runtime resolver. Given the CONTAINER_RUNTIME value and a probe for
 * binary availability, decide which runtime to use.
 *
 * `auto` only ever selects a container runtime — it never silently falls back
 * to the sandbox-free host mode, which must be requested explicitly.
 */
export function resolveRuntime(
  envValue: string | undefined,
  isAvailable: (bin: string) => boolean,
): ResolvedRuntime {
  const selection = (envValue || 'auto').trim().toLowerCase();

  if (selection === 'host') {
    return { kind: 'host', bin: null };
  }

  if (KNOWN_CONTAINER_BINS.has(selection)) {
    return { kind: 'container', bin: selection };
  }

  // auto (or any unrecognized value): first available container runtime
  for (const bin of AUTO_DETECT_BINS) {
    if (isAvailable(bin)) {
      return { kind: 'container', bin };
    }
  }
  return { kind: 'container', bin: null };
}

/** Whether a command is resolvable on PATH, cross-platform. */
export function isCommandAvailable(bin: string): boolean {
  try {
    const probe =
      process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const resolved = resolveRuntime(
  process.env.CONTAINER_RUNTIME,
  isCommandAvailable,
);

/** The selected runtime kind ('container' or 'host'). */
export const RUNTIME_KIND: RuntimeKind = resolved.kind;

/**
 * The container runtime binary name. Falls back to 'docker' for back-compat
 * when nothing was detected (callers surface a clear error before use).
 */
export const CONTAINER_RUNTIME_BIN = resolved.bin || 'docker';

/** Whether the agent runs directly on the host with no container sandbox. */
export function isHostMode(): boolean {
  return RUNTIME_KIND === 'host';
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns the shell command to stop a container by name. */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  if (isHostMode()) {
    logger.info(
      'CONTAINER_RUNTIME=host — agents run on the host with no container sandbox',
    );
    return;
  }

  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    logger.debug(
      { runtime: CONTAINER_RUNTIME_BIN },
      'Container runtime already running',
    );
  } catch (err) {
    logger.error(
      { err, runtime: CONTAINER_RUNTIME_BIN },
      'Failed to reach container runtime',
    );
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      `║  FATAL: Container runtime '${CONTAINER_RUNTIME_BIN}' failed to start`.padEnd(
        65,
      ) + '║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      `║  1. Ensure ${CONTAINER_RUNTIME_BIN} is installed and running`.padEnd(
        65,
      ) + '║',
    );
    console.error(`║  2. Run: ${CONTAINER_RUNTIME_BIN} info`.padEnd(65) + '║');
    console.error(
      '║  3. Restart NanoClaw (or set CONTAINER_RUNTIME=host)           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  if (isHostMode()) return;
  try {
    const output = execSync(
      // Double quotes work in both POSIX shells and cmd.exe; single quotes are
      // passed literally by cmd.exe on Windows and would break the format.
      `${CONTAINER_RUNTIME_BIN} ps --filter name=nanoclaw- --format "{{.Names}}"`,
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        execSync(stopContainer(name), { stdio: 'pipe' });
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
