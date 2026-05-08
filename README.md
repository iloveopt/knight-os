# knight-os

AI companion OS for OpenClaw — memory, reflection, and identity framework.

Give your OpenClaw AI a name, a personality, and the ability to learn from experience.

## Prerequisites

Install [OpenClaw](https://github.com/openclaw/openclaw) first:

```bash
npm install -g openclaw
```

## Install

```bash
npm install -g knight-os
```

## Quick Start

```bash
knight setup
```

The setup wizard will:

1. Verify OpenClaw is installed
2. Ask for your AI's name, your name, and timezone
3. Write all framework files into your OpenClaw workspace
4. Optionally configure Telegram notifications
5. Register the Heartbeat scheduler (macOS/Linux)

After setup, start chatting via OpenClaw:

```bash
openclaw chat
```

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
├── memory/
│   ├── ai-patterns.md        # Learned behavior rules (grows over time)
│   ├── user-patterns.md      # Observed user behavior
│   ├── reflections/          # Task reflection logs (JSONL)
│   ├── logs/                 # Session logs
│   └── projects/<name>/      # Per-project context
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
knight setup      # Configure Knight OS (requires OpenClaw installed)
knight init       # Initialize workspace standalone (no OpenClaw check)
knight chat       # Interactive AI chat (Anthropic API directly)
knight status     # Check workspace file status
knight version    # Show version
```

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

---

## Contributing

Contributions welcome. Keep templates generic — no personal data or tool credentials.

1. Fork this repository
2. Create a feature branch
3. Submit a pull request

## License

MIT
