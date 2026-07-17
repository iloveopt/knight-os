# knight-os

AI companion OS for OpenClaw — memory, reflection, and identity framework.

Give your OpenClaw AI a name, a personality, and the ability to learn from experience.

## Prerequisites

Use Knight OS after [OpenClaw](https://github.com/openclaw/openclaw) is already installed, or from inside an existing OpenClaw agent environment.

Knight OS does not install OpenClaw and does not require the OpenClaw npm package or global `openclaw` binary to be available during setup.

## Install

```bash
npm install -g knight-os
```

## Quick Start

```bash
knight setup
```

The setup wizard will:

1. Configure and verify your OpenClaw workspace path
2. Ask for your AI's name, your name, and timezone
3. Write all framework files into your OpenClaw workspace
4. Optionally configure Telegram notifications
5. Register the Heartbeat scheduler (macOS/Linux)

After setup, start chatting via OpenClaw:

```bash
openclaw chat
```

### Existing OpenClaw workspace or memory

If your workspace already has memory files, Knight OS treats them as user-owned assets. Files such as `MEMORY.md`, `SOUL.md`, `USER.md`, `REDLINES.md`, `AGENTS.md`, `PROJECTS.md`, `TOOLS.md`, `HEARTBEAT.md`, and `memory/*.md` are preserved.

For an existing workspace:

```bash
knight doctor
knight adopt --plan
knight adopt
```

`knight adopt --plan` scans your workspace and classifies each action:

- `preserve`: existing user files that Knight OS will not touch
- `add`: missing files, directories, or scripts that are safe to create
- `sidecar`: Knight template files written next to existing user files, such as `AGENTS.knight.md` or `memory/knight-ai-patterns.md`
- `manual`: files that need human review, such as an existing `knight.config.json`

`knight adopt` creates a full backup first, then only adds missing files or sidecar files. It also writes `.knight/manifest.json` and `.knight/adoption-report.md` so you can inspect what Knight OS created.

`knight setup` also detects existing memory markers and switches to a safe path: it creates a backup first, adds only missing files, renders template placeholders, and skips anything already present. For an existing memory workspace, prefer `knight adopt --plan` first.

### Agent/git install

If you are already running inside an OpenClaw agent environment and prefer not to install Knight OS globally, clone this repo and run setup directly:

```bash
git clone https://github.com/iloveopt/knight-os.git ~/.local/share/knight-os
node ~/.local/share/knight-os/bin/knight.js setup
```

This does not install OpenClaw.

### Custom workspace path

If your OpenClaw workspace is not at the default `~/.openclaw/workspace`, enter your path when prompted:

```
Workspace directory [~/.openclaw/workspace]: /workspace/projects
```

Knight OS will write all files there and OpenClaw will pick them up automatically.

---

## Upgrading Safely

When you install a new version of knight-os, your personal data is never touched.

**Code and data live in separate places:**

```
npm upgrade knight-os
  ↓
Updates:  /usr/local/lib/node_modules/knight-os/   (program files)
Ignores:  ~/.openclaw/workspace/                   (your data — always safe)
```

To apply any new templates or run data migrations:

```bash
knight upgrade --plan
knight upgrade
```

This will:

1. Preview the upgrade with `knight upgrade --plan` without writing files
2. Check if your workspace data format needs updating
3. Create a full timestamped backup before making any changes
4. Run any pending migrations (adds new files, never deletes yours)
5. Add new template files introduced in the new version, with placeholders rendered
6. Leave existing files untouched, including `AGENTS.md`, `PROJECTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `SOUL.md`, `MEMORY.md`, `USER.md`, `REDLINES.md`, and existing `memory/*.md`

### Safe Upgrade Loop

```bash
knight doctor
knight upgrade --plan
knight upgrade
knight rollback --list
```

If you want to inspect a restore before applying it:

```bash
knight rollback --dry-run
```

Example output:

```
🔄 knight-os — Upgrade Check
   Workspace: ~/.openclaw/workspace

   📦 Backing up to .knight-backups/2026-05-11T14-51-43 …
   ✅ Backup complete.
   ⚙️  Migration 0→1: Bootstrap versioning
   ✅ Done.

   🔒 Protected files untouched:
      SOUL.md, MEMORY.md, USER.md, REDLINES.md

✅ Upgrade complete. Workspace is at data v1.
```

Backups are kept at `~/.openclaw/workspace/.knight-backups/` and can be used to roll back at any time.

---

## How Memory Works

This is the core of what knight-os adds. Your AI learns from experience through a simple loop:

```
You finish a task
    ↓
write-reflection.py  →  memory/reflections/YYYY-MM-DD.jsonl
    ↓
Heartbeat runs  →  reflection-analyzer.py  →  candidate rules extracted
    ↓
You confirm  →  rules written to memory/ai-patterns.md
    ↓
Next session  →  ai-patterns.md loaded in system prompt  →  AI behaves better
```

**In practice:**

```bash
# After completing any task, run:
python3 ~/.openclaw/workspace/scripts/write-reflection.py \
  --context "Deployed new feature" \
  --what_worked "Clear requirements helped" \
  --what_failed "Forgot to update tests" \
  --next_time "Write tests first, then implement"

# Every 6 hours (automatic), the heartbeat:
#   1. Scans reflections for repeated failure patterns
#   2. Extracts candidate rules
#   3. Notifies you (if Telegram configured)

# You review and add confirmed rules to:
#   ~/.openclaw/workspace/memory/ai-patterns.md
```

Over time, `ai-patterns.md` accumulates rules your AI uses automatically in every session.

---

## Multi-Agent Memory / Agent Adapters

Knight OS is becoming a portable personal memory layer:

> Bring your own agent. Keep one memory.

Claude, Codex, and OpenClaw are different executors. Knight OS provides the shared identity, memory, rules, reflection, and project context they can all read. It is not a multi-agent scheduler and does not route tasks between agents.

`knight sync` writes canonical memory into `.knight/core/`:

```
.knight/core/
├── identity.md
├── user.md
├── memory.md
├── rules.md
└── projects.md
```

Those files are generated from your existing workspace sources such as `SOUL.md`, `USER.md`, `MEMORY.md`, `REDLINES.md`, `PROJECTS.md`, and `memory/*patterns.md`.

List available adapters:

```bash
knight adapters list
```

Generate one adapter instruction file:

```bash
knight sync --agent claude
knight sync --agent codex
knight sync --agent openclaw
```

Or generate all adapters:

```bash
knight sync --all
```

Preview without writing:

```bash
knight sync --agent claude --plan
knight sync --all --plan
```

Adapter output strategy:

- OpenClaw uses `AGENTS.md` when available; if a user-owned `AGENTS.md` already exists, Knight writes `AGENTS.openclaw.md`.
- Claude uses `CLAUDE.md` when available; if a user-owned `CLAUDE.md` already exists, Knight writes `CLAUDE.knight.md`.
- Codex uses `AGENTS.codex.md` by default so it does not collide with OpenClaw's `AGENTS.md`.

Knight records generated files in `.knight/manifest.json`. Existing user instruction files are not overwritten by default.

---

## Memory File Structure

```
~/.openclaw/workspace/
├── SOUL.md              # AI identity and personality
├── AGENTS.md            # Boot sequence, behavior norms, script reference
├── MEMORY.md            # Long-term memory index
├── REDLINES.md          # Safety boundaries
├── USER.md              # Your profile and preferences
├── TOOLS.md             # Tool reference and credentials map
├── PROJECTS.md          # Active project index
├── HEARTBEAT.md         # Heartbeat task configuration
├── CLAUDE.md            # Claude adapter output, when generated
├── AGENTS.codex.md      # Codex adapter output, when generated
├── .knight-version      # Data format version (managed automatically)
├── .knight/
│   ├── manifest.json    # Knight-managed file manifest
│   └── core/            # Canonical portable memory generated by knight sync
├── .knight-backups/     # Upgrade backups (managed automatically)
├── memory/
│   ├── ai-patterns.md        # Learned behavior rules (grows over time)
│   ├── user-patterns.md      # Observed user behavior
│   ├── reflections/          # Task reflection logs (JSONL)
│   ├── logs/                 # Session logs
│   ├── projects/<name>/      # Per-project context
│   ├── templates/            # Reusable task templates
│   └── references/           # Reference documents
└── scripts/
    ├── write-reflection.py   # Log a reflection after task completion
    ├── reflection-analyzer.py # Extract rules from reflection patterns
    ├── heartbeat.py          # Periodic maintenance tasks
    ├── compress-memory.py    # Archive old logs
    └── knight-status.py      # Workspace health check
```

---

## Commands

```bash
knight setup      # Configure Knight OS for an OpenClaw workspace
knight init       # Initialize a new workspace
knight chat       # Interactive AI chat (Anthropic API directly)
knight status     # Check workspace file status
knight doctor     # Full workspace health report with next actions
knight upgrade    # Safely migrate data + refresh templates after npm upgrade
knight upgrade --plan
                  # Preview migrations/templates without writing files
knight adopt      # Adopt an existing OpenClaw workspace without overwriting memory
knight adopt --plan
                  # Preview preserve/add/sidecar/manual actions without writing files
knight adapters list
                  # List available agent adapters
knight sync --agent claude
knight sync --agent codex
knight sync --agent openclaw
                  # Generate canonical memory + one adapter instruction file
knight sync --all # Generate canonical memory + all supported adapters
knight sync --all --plan
                  # Preview sync actions without writing files
knight rollback   # Restore workspace from a previous backup
knight rollback --list
                  # List available backups without entering restore flow
knight rollback --dry-run
                  # Preview latest backup restore without writing files
knight dashboard  # Generate a local HTML dashboard
knight version    # Show version
```

### `knight upgrade`

Run this after every `npm upgrade knight-os` to apply new templates and data migrations.

Safe by design:
- Always backs up first, never migrates without a backup
- `knight upgrade --plan` previews current data version, target data version, pending migrations, new templates, protected files, and existing templates that will not be overwritten
- Protected files (`SOUL.md`, `MEMORY.md`, `USER.md`, `REDLINES.md`) are never overwritten
- Migrations only add or transform — they never delete your content
- If something goes wrong, your backup is at `.knight-backups/<timestamp>/`

### `knight doctor`

Run this anytime to check workspace health:

```bash
knight doctor
```

The report checks core files, memory directories, `.knight-version`, backups, reflections, log size, MEMORY.md freshness, and heartbeat configuration. It also prints executable next actions such as `knight setup`, `knight upgrade --plan`, or `knight rollback --list`.

### `knight rollback`

Use rollback commands to inspect and restore backups:

```bash
knight rollback --list
knight rollback --dry-run
knight rollback
```

Rollback keeps protected files untouched: `SOUL.md`, `MEMORY.md`, `USER.md`, `REDLINES.md`.

### Standalone chat (`knight chat`)

If you want to chat without OpenClaw, you can use the built-in chat command.  
Requires `ANTHROPIC_API_KEY` in your workspace `.env`.

---

## Runtime Scripts

```bash
# Log a reflection after completing a task
python3 scripts/write-reflection.py \
  --context "Task title" \
  --what_worked "What went well" \
  --what_failed "What did not work" \
  --next_time "How to improve"

# Analyze reflection patterns (run by heartbeat automatically)
python3 scripts/reflection-analyzer.py --min-count 2

# Check workspace health
python3 scripts/knight-status.py

# Archive old logs
python3 scripts/compress-memory.py --execute

# Run heartbeat manually
python3 scripts/heartbeat.py
```

---

## Core Principles

### Framework & Content Separation

knight-os provides the **structure** — the files, the rules, the mechanisms.  
You provide the **content** — your AI's personality, your preferences, your specific tools.

### Learning from Feedback

The system evolves. Corrections become rules (`ai-patterns.md`), observations become understanding (`user-patterns.md`), decisions become memory (`MEMORY.md`). Nothing is static.

### Memory Layering

| Layer | Location | When promoted |
|-------|----------|--------------|
| Working | In-context (current session) | — |
| Short-term | `memory/YYYY-MM-DD.md` | End of session |
| Long-term | `MEMORY.md` | Pattern repeats 3+ times or user confirms |
| Patterns | `memory/ai-patterns.md` | After reflection analysis + confirmation |

### Safe Upgrades

User data and program code are physically separated from day one. Upgrading the program never touches the data. When the data format needs to change, migrations run with a full backup, in order, with version tracking — so partial failures are always recoverable.

---

## Contributing

Contributions welcome. Keep templates generic — no personal data or tool credentials.

1. Fork this repository
2. Create a feature branch
3. Submit a pull request

## License

MIT
