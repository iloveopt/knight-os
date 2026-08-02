# RFC: v0.5 Safe Context Federation

Status: Accepted foundation scope (2026-07-25)

## Goal
Make Knight OS a local-first personal AI Context Hub: **Bring your own agent. Keep your context.**

## Invariants
- User-owned sources are the source of truth and Knight never writes them during federation.
- `.knight/core/*` is a generated, read-only projection, never canonical storage.
- An existing file is user-owned unless the registry explicitly records Knight ownership.
- Knight updates a managed output only when its current hash equals its recorded generated hash.
- No changed inputs means sync performs no output writes.

## Model
- **Source:** a user-owned file mapped to `identity`, `user`, `memory`, `rules`, or `projects`. In v0.5, the memory domain also discovers top-level `memory/*pattern*.md` files; sync includes them in the memory projection and registry.
- **Projection:** generated domain snapshot under `.knight/core/`, with source references.
- **Adapter:** agent-specific entry file pointing to projections.
- **Registry:** schema v2 state in `.knight/manifest.json`, retaining the v1 `files` field for compatibility while adding structured `sources`, `projections`, and `adapters`.

Using the existing manifest avoids two competing ownership ledgers. A v1 manifest is read compatibly and upgraded on the next successful sync.

## Planning, Status, and Handoff
`knight inspect` classifies known files without writing. `knight status` compares current hashes with registry hashes to expose source drift and managed-output conflict. `knight sync --workspace PATH` explicitly selects the source workspace rather than relying on configuration or `KNIGHT_WORKSPACE`.

`knight export claude --workspace SOURCE --output HANDOFF` creates a portable Claude Code bundle directly from generated projections. Export is projection-only by default: it includes the five `.knight/core/` domain snapshots, a bundle manifest, and a root `CLAUDE.md`, but never copies raw logs, `.env`, credentials, contracts, project detail files, or arbitrary sources.

`knight sync --agent hermes` generates `.hermes.md`, the current official Hermes Agent highest-priority project-context entry. The generated entry only names the `.knight/core/*` projections; it does not copy or rewrite user sources. Hermes also accepts `HERMES.md`, but it cannot be a safe sidecar because an existing user-owned `.hermes.md` wins Hermes's priority order. Knight consequently preserves an unmanaged `.hermes.md` and reports a conflict instead of writing an ineffective fallback. `knight export hermes --workspace SOURCE --output HANDOFF` generates the same canonical `.hermes.md` into an otherwise empty portable bundle. Hermes's global `HERMES_HOME/SOUL.md` is deliberately outside the adapter scope.

`--include-project <name>` is the only v0.5 exception to the projection-only default. It validates `<name>` as a safe project path segment and copies only existing `memory/projects/<name>/main.md` and `memory/projects/<name>/context-snapshot.md`. It does not recurse, include sibling projects, or include other files from the selected project directory.

`--visible` adds a human-readable review layer under `context/`. The canonical agent context remains `.knight/core/*`; visible files mirror the generated core projections into `context/core/*` and, when `--include-project` is used, mirror the selected project files into `context/projects/<name>/`.

Export does not write the source workspace and refuses to overwrite a non-empty output directory.

## Conflict Policy
Unmanaged adapter targets are preserved and a known sidecar is selected. If both target and sidecar are unmanaged, sync reports the conflict and writes neither. Modified managed outputs are also preserved and reported as conflicts.

## Non-goals
No cloud sync, vector database, collaboration, automatic bidirectional memory merge, strong consistency, or multi-agent scheduling.
