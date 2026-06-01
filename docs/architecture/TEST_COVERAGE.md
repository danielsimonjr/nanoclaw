# Test Coverage Analysis

**Generated**: 2026-06-01

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 61 |
| Total Test Files | 44 |
| Source Files with Tests | 37 |
| Source Files without Tests | 24 |
| Coverage | 60.7% |

---

## Source Files Without Test Coverage

The following 24 source files are not directly imported by any test file:

### agent-runner/

- `container/agent-runner/src/index.ts` → Expected test: `tests/unit/agent-runner/index.test.ts`
- `container/agent-runner/src/ipc-mcp-stdio.ts` → Expected test: `tests/unit/agent-runner/ipc-mcp-stdio.test.ts`

### root/

- `scripts/apply-skill.ts` → Expected test: `tests/unit/root/apply-skill.test.ts`
- `scripts/post-update.ts` → Expected test: `tests/unit/root/post-update.test.ts`
- `scripts/run-ci-tests.ts` → Expected test: `tests/unit/root/run-ci-tests.test.ts`
- `scripts/run-migrations.ts` → Expected test: `tests/unit/root/run-migrations.test.ts`
- `scripts/update-core.ts` → Expected test: `tests/unit/root/update-core.test.ts`
- `setup/container.ts` → Expected test: `tests/unit/root/container.test.ts`
- `setup/environment.ts` → Expected test: `tests/unit/root/environment.test.ts`
- `setup/groups.ts` → Expected test: `tests/unit/root/groups.test.ts`
- `setup/index.ts` → Expected test: `tests/unit/root/index.test.ts`
- `setup/mounts.ts` → Expected test: `tests/unit/root/mounts.test.ts`
- `setup/node-script.ts` → Expected test: `tests/unit/root/node-script.test.ts`
- `setup/register.ts` → Expected test: `tests/unit/root/register.test.ts`
- `setup/status.ts` → Expected test: `tests/unit/root/status.test.ts`
- `setup/verify.ts` → Expected test: `tests/unit/root/verify.test.ts`
- `setup/whatsapp-auth.ts` → Expected test: `tests/unit/root/whatsapp-auth.test.ts`
- `skills-engine/git-utils.ts` → Expected test: `tests/unit/root/git-utils.test.ts`
- `skills-engine/index.ts` → Expected test: `tests/unit/root/index.test.ts`
- `skills-engine/init.ts` → Expected test: `tests/unit/root/init.test.ts`
- `skills-engine/migrate.ts` → Expected test: `tests/unit/root/migrate.test.ts`
- `src/whatsapp-auth.ts` → Expected test: `tests/unit/root/whatsapp-auth.test.ts`
- `vitest.config.ts` → Expected test: `tests/unit/root/vitest.config.test.ts`
- `vitest.skills.config.ts` → Expected test: `tests/unit/root/vitest.skills.config.test.ts`

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `scripts/generate-ci-matrix.ts` | `ci-matrix.test.ts` |
| `setup/platform.ts` | `platform-windows.test.ts`, `platform.test.ts` |
| `setup/service.ts` | `service.test.ts` |
| `skills-engine/apply.ts` | `apply.test.ts` |
| `skills-engine/backup.ts` | `backup.test.ts` |
| `skills-engine/constants.ts` | `constants.test.ts`, `customize.test.ts`, `lock.test.ts` |
| `skills-engine/customize.ts` | `customize.test.ts` |
| `skills-engine/file-ops.ts` | `file-ops.test.ts` |
| `skills-engine/fs-utils.ts` | `fs-utils.test.ts` |
| `skills-engine/lock.ts` | `lock.test.ts` |
| `skills-engine/manifest.ts` | `manifest.test.ts` |
| `skills-engine/merge.ts` | `merge.test.ts` |
| `skills-engine/path-remap.ts` | `path-remap.test.ts` |
| `skills-engine/rebase.ts` | `rebase.test.ts` |
| `skills-engine/replay.ts` | `replay.test.ts` |
| `skills-engine/resolution-cache.ts` | `resolution-cache.test.ts` |
| `skills-engine/state.ts` | `apply.test.ts`, `customize.test.ts`, `manifest.test.ts`, `path-remap.test.ts`, `state.test.ts`, `update.test.ts` |
| `skills-engine/structured.ts` | `structured.test.ts` |
| `skills-engine/types.ts` | `ci-matrix.test.ts` |
| `skills-engine/uninstall.ts` | `uninstall.test.ts` |
| `skills-engine/update.ts` | `update.test.ts` |
| `channels/whatsapp.ts` | `whatsapp.test.ts` |
| `src/config.ts` | `formatting.test.ts` |
| `src/container-runner.ts` | `container-runner-host-e2e.test.ts`, `container-runner-host.test.ts`, `container-runner.test.ts`, `task-scheduler-run.test.ts` |
| `src/container-runtime.ts` | `container-runtime.test.ts` |
| `src/db.ts` | `whatsapp.test.ts`, `db-accessors.test.ts`, `db.test.ts`, `ipc-auth.test.ts`, `ipc-watcher.test.ts`, `routing.test.ts`, `task-scheduler-run.test.ts`, `task-scheduler.test.ts` |
| `src/env.ts` | `env.test.ts` |
| `src/fs-sync.ts` | `fs-sync.test.ts` |
| `src/group-folder.ts` | `group-folder.test.ts`, `task-scheduler-run.test.ts` |
| `src/group-queue.ts` | `group-queue.test.ts` |
| `src/index.ts` | `routing.test.ts` |
| `src/ipc.ts` | `ipc-auth.test.ts`, `ipc-watcher.test.ts` |
| `src/logger.ts` | `container-runtime.test.ts` |
| `src/mount-security.ts` | `mount-security.test.ts` |
| `src/router.ts` | `formatting.test.ts`, `router-routing.test.ts` |
| `src/task-scheduler.ts` | `task-scheduler-run.test.ts`, `task-scheduler.test.ts` |
| `src/types.ts` | `container-runner-host-e2e.test.ts`, `container-runner-host.test.ts`, `container-runner.test.ts`, `db-accessors.test.ts`, `formatting.test.ts`, `ipc-auth.test.ts`, `ipc-watcher.test.ts`, `mount-security.test.ts`, `router-routing.test.ts`, `task-scheduler-run.test.ts` |

---

## Test File Details

| Test File | Imports from Source |
|-----------|---------------------|
| `setup/environment.test.ts` | 0 files |
| `setup/platform-windows.test.ts` | 1 files |
| `setup/platform.test.ts` | 1 files |
| `setup/service.test.ts` | 1 files |
| `__tests__/apply.test.ts` | 2 files |
| `__tests__/backup.test.ts` | 1 files |
| `__tests__/ci-matrix.test.ts` | 2 files |
| `__tests__/constants.test.ts` | 1 files |
| `__tests__/customize.test.ts` | 3 files |
| `__tests__/fetch-upstream.test.ts` | 0 files |
| `__tests__/file-ops.test.ts` | 1 files |
| `__tests__/fs-utils.test.ts` | 1 files |
| `__tests__/lock.test.ts` | 2 files |
| `__tests__/manifest.test.ts` | 2 files |
| `__tests__/merge.test.ts` | 1 files |
| `__tests__/path-remap.test.ts` | 2 files |
| `__tests__/rebase.test.ts` | 1 files |
| `__tests__/replay.test.ts` | 1 files |
| `__tests__/resolution-cache.test.ts` | 1 files |
| `__tests__/run-migrations.test.ts` | 0 files |
| `__tests__/state.test.ts` | 1 files |
| `__tests__/structured.test.ts` | 1 files |
| `__tests__/uninstall.test.ts` | 1 files |
| `__tests__/update-core-cli.test.ts` | 0 files |
| `__tests__/update.test.ts` | 2 files |
| `channels/whatsapp.test.ts` | 2 files |
| `src/container-runner-host-e2e.test.ts` | 2 files |
| `src/container-runner-host.test.ts` | 2 files |
| `src/container-runner.test.ts` | 2 files |
| `src/container-runtime.test.ts` | 2 files |
| `src/db-accessors.test.ts` | 2 files |
| `src/db.test.ts` | 1 files |
| `src/env.test.ts` | 1 files |
| `src/formatting.test.ts` | 3 files |
| `src/fs-sync.test.ts` | 1 files |
| `src/group-folder.test.ts` | 1 files |
| `src/group-queue.test.ts` | 1 files |
| `src/ipc-auth.test.ts` | 3 files |
| `src/ipc-watcher.test.ts` | 3 files |
| `src/mount-security.test.ts` | 2 files |
| `src/router-routing.test.ts` | 2 files |
| `src/routing.test.ts` | 2 files |
| `src/task-scheduler-run.test.ts` | 5 files |
| `src/task-scheduler.test.ts` | 2 files |
