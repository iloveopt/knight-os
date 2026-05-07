# knight-os

AI companion OS for OpenClaw — memory, reflection, and identity framework.

## What is OpenClaw?

OpenClaw is an AI personal assistant platform that defines AI behavior, memory, and identity through Markdown files in a workspace directory.

## Install

```bash
npm install -g knight-os
```

## Quick Start

```bash
knight init
```

The init wizard will ask you:

1. Your AI companion's name
2. Your name
3. Your timezone
4. Workspace directory (default: `~/.openclaw/workspace`)

Then it writes all framework files into your workspace, personalized with your answers.

## Chat

```bash
knight chat
```

Starts an interactive chat session with your AI companion. Your workspace files (SOUL.md, MEMORY.md, AGENTS.md) are automatically loaded as the system prompt.

**Prerequisites:** Anthropic API key configured via `knight init` or set as `ANTHROPIC_API_KEY` in your workspace `.env` file.

## Runtime Features

```bash
# After completing a task, write a reflection
python3 scripts/write-reflection.py \
  --context "What you did" \
  --what_worked "What went well" \
  --what_failed "What did not work" \
  --next_time "How to improve"

# Run heartbeat (maintenance tasks)
python3 scripts/heartbeat.py

# Analyze patterns from reflections
python3 scripts/reflection-analyzer.py

# Check workspace health
python3 scripts/knight-status.py

# Archive old logs
python3 scripts/compress-memory.py --execute
```

## File Reference

| File | Purpose |
|------|---------|
| `AGENTS.md` | Workspace entry point — boot sequence, file map, behavior norms |
| `SOUL.md` | AI identity — personality, working style, evolution direction |
| `MEMORY.md` | Long-term memory index — quick reference, layering system, rules |
| `HEARTBEAT.md` | Periodic self-check — task scoring, feedback review, memory scan |
| `REDLINES.md` | Safety boundaries — red lines, attack response, risk classification |
| `USER.md` | User profile — personality, work style, preferences |
| `TOOLS.md` | Tool reference — credentials map, on-demand loading triggers |
| `memory/TEMPLATE-daily.md` | Daily report template |
| `memory/ai-patterns.md` | AI behavior rules — learned from feedback |
| `memory/user-patterns.md` | User observation records — patterns and preferences |
| `scripts/` | Runtime scripts — reflection, analysis, heartbeat, compression, status |
| `knight.config.json` | Default configuration template |
| `src/config.js` | Unified config loader module |

## Core Principles

### Framework & Content Separation

knight-os provides the **structure** — the files, the rules, the mechanisms. You provide the **content** — your preferences, your AI's personality tweaks, your specific tools. The framework never assumes your use case.

### Learning from Feedback

The system is designed to evolve. Corrections become rules (`ai-patterns.md`), observations become understanding (`user-patterns.md`), and decisions become memory (`MEMORY.md`). Nothing is static.

### Memory Layering

Memory is organized in layers with clear promotion rules:
- **Working** → in-context (current session)
- **Short-term** → daily logs
- **Long-term** → MEMORY.md
- **Patterns** → ai-patterns.md / user-patterns.md

## Commands

```bash
knight init      # Initialize a new workspace
knight chat      # Start interactive AI chat session
knight status    # Check workspace file status
knight version   # Show version number
```

## Contributing

Contributions are welcome! To get started:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `node bin/knight.js version` to verify the CLI works
5. Submit a pull request

Please keep templates generic — no personal information or specific tool credentials.

## License

MIT
