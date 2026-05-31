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
- `--include-tests`, `-t` — include `*.test.ts` files in the analysis (drives `TEST_COVERAGE.md`)
- `--help`, `-h` — show usage

It reads `<root>/package.json` for the project name/version and scans
`<root>/src`.

## Output

Written to `<root>/docs/architecture/`:

- `DEPENDENCY_GRAPH.md` — human-readable graph (modules, imports/exports, matrix, Mermaid diagram, stats)
- `dependency-graph.json` — full machine-readable graph
- `dependency-graph.yaml` — compact YAML form of the graph
- `dependency-summary.compact.json` — minimal summary stats
- `TEST_COVERAGE.md` + `test-coverage.json` — file-level test coverage (with `--include-tests`)
- `unused-analysis.md` — potentially unused files and exports

## Scope (NanoClaw note)

The scanner only walks `src/` (NanoClaw's orchestrator core). It does **not**
cover `setup/`, `skills-engine/`, or `container/agent-runner/` — those
subsystems are described in the hand-authored docs under `docs/architecture/`
([ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md),
[COMPONENTS.md](../../docs/architecture/COMPONENTS.md)).

## Features

- Parses imports and exports per file
- Categorizes files into logical modules
- Detects circular dependencies (runtime vs type-only)
- Flags potentially unused files and exports
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
