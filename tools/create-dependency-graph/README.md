# create-dependency-graph

A standalone TypeScript utility (copied into NanoClaw under `tools/`) that scans
the codebase and generates dependency + test-coverage documentation under
`docs/architecture/`.

## Usage

Run it from the project root with `tsx`:

```bash
# Analyze NanoClaw's src/ (current directory as root), including test files
npx tsx tools/create-dependency-graph/create-dependency-graph.ts --root="$(pwd)" --include-tests
```

Options:

- `--root=<path>` — project root to analyze (default: current directory)
- `--exclude=<a,b,c>` — replace the default skip list of directory names
- `--also-exclude=<a,b>` — add directory names to the default skip list
- `--include-tests`, `-t` — include `*.test.ts` files in the analysis (drives `TEST_COVERAGE.md` and makes unused-export detection test-aware)
- `--help`, `-h` — show usage

It reads `<root>/package.json` for the project name/version (and its `scripts`,
to recognize entry points like `tsx src/whatsapp-auth.ts`), then scans the
**whole project root** for first-party `.ts` source, skipping a default set of
non-source directories:

```
node_modules, dist, build, coverage, .git, .nanoclaw, .github, .claude,
tools, docs, groups, store, data, launchd, assets, config-examples, repo-tokens
```

`__tests__/` and `__mocks__/` are skipped for the source graph but still scanned
for `--include-tests` coverage.

## Output

Written to `<root>/docs/architecture/`:

- `DEPENDENCY_GRAPH.md` — human-readable graph (modules, imports/exports, matrix, Mermaid diagram, stats)
- `dependency-graph.json` — full machine-readable graph
- `dependency-graph.yaml` — compact YAML form of the graph
- `dependency-summary.compact.json` — minimal summary stats
- `TEST_COVERAGE.md` + `test-coverage.json` — file-level test coverage (with `--include-tests`)
- `unused-analysis.md` — potentially unused files and exports

## Scope (NanoClaw note)

The scanner walks **all first-party TypeScript source**: `src/`, `setup/`,
`skills-engine/`, `scripts/`, and `container/agent-runner/src/` (the separate
agent package appears as its own cluster, with no import edges to the main app).
The `tools/` folder and the non-source directories listed above are excluded.

## Features

- Parses static **and dynamic** (`import('./x')`) imports, plus exports per file
- Categorizes files into modules by directory (across all source roots)
- Recognizes entry points (shebang scripts, `index.ts`, `scripts/`, npm-script
  targets, `*.config.ts`, and files referenced by name like spawned children)
  so they aren't mis-reported as unused
- Detects circular dependencies (runtime vs type-only)
- Flags potentially unused files and exports (test imports count as usage with
  `--include-tests`)
- Generates statistics (file count, LOC, export count, etc.)
- Produces human-readable Markdown plus machine-readable JSON/YAML

## Setup

The tool is self-contained with its own `package.json`/`tsconfig.json`. Its only
runtime dependency is `js-yaml`; running via `npx tsx` (already a NanoClaw dev
dependency) needs no separate install. To work on the tool in isolation:

```bash
cd tools/create-dependency-graph
npm install        # installs js-yaml + types
npx tsc --noEmit   # typecheck
```
