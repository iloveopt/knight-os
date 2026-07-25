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

## Planning and Status
`knight inspect` classifies known files without writing. `knight status` compares current hashes with registry hashes to expose source drift and managed-output conflict.

## Conflict Policy
Unmanaged adapter targets are preserved and a known sidecar is selected. If both target and sidecar are unmanaged, sync reports the conflict and writes neither. Modified managed outputs are also preserved and reported as conflicts.

## Non-goals
No cloud sync, vector database, collaboration, automatic bidirectional memory merge, strong consistency, or multi-agent scheduling.
