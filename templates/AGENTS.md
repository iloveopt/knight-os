# AGENTS.md — {{AI_NAME}} Workspace Entry Point

> This is the first file {{AI_NAME}} reads when a session starts.

## File Responsibilities

| File | Purpose |
|------|---------|
| AGENTS.md | Workspace boot sequence and structural overview |
| REDLINES.md | Absolute safety boundaries — never violate |
| SOUL.md | {{AI_NAME}}'s identity, personality, and working style |
| MEMORY.md | Long-term memory index and quick-reference |
| memory/user-patterns.md | Observed user behavior patterns |
| memory/ai-patterns.md | {{AI_NAME}}'s learned behavior rules |
| PROJECTS.md | Active project index |
| HEARTBEAT.md | Periodic self-check mechanism |
| USER.md | User profile and preferences |
| TOOLS.md | Available tools and credentials reference |

## High-Priority Rules

1. **Error = Report** — If something fails or seems wrong, report immediately. Never hide errors.
2. **Diff before modify** — Before modifying any core document (AGENTS/SOUL/REDLINES/MEMORY), show the diff and get confirmation.
3. **Speak up** — If you have a better idea or disagree, say so. Silence is not agreement.

## Boot Sequence

On session start, read files in this order:

1. `AGENTS.md` (this file — get orientation)
2. `REDLINES.md` (load safety boundaries)
3. `SOUL.md` (load identity and personality)
4. `MEMORY.md` (load long-term memory index)
5. `memory/user-patterns.md` (load user behavior context)
6. `memory/ai-patterns.md` (load own behavior rules)
7. `USER.md` (load user profile)
8. `TOOLS.md` (load available tools)
9. `memory/YYYY-MM-DD.md` for today + yesterday (load recent context; skip if file doesn't exist)
10. `PROJECTS.md` (load project index — on-demand per project)

> **Why daily logs?** Without reading recent logs, the AI starts each session with no memory of what happened yesterday. Always load today + yesterday at boot.

## On-Demand Loading Trigger Table

Do NOT load everything at boot. Load these files only when the matching situation arises:

| Trigger | Load |
|---------|------|
| Replying to a message / adjusting tone | `memory/ai-patterns.md` chat section |
| Before executing a task | `memory/ai-patterns.md` exec section |
| User mentions a project by name | `memory/projects/<name>/main.md` |
| Executing a task tied to a project | `memory/projects/<name>/main.md` + latest log |
| Heartbeat / daily review | `PROJECTS.md` index only (no main.md) |
| Writing daily report | Update main.md → Current Sprint with today's progress |
| Writing to memory / log / daily report | Check `memory/ai-patterns.md` memory section |
| Received group message / someone @-mentioned | group handling rules |
| Involves code / development / PR | `memory/ai-patterns.md` code section |
| Using scripts / external tools | `memory/ai-patterns.md` tool section |
| Writing copy / articles / presentations | `memory/user-patterns.md` writing style section |}

> **Principle:** Static identity + rules → system prompt (always present). Long-term memory → load at session start. Project details + situational rules → lazy-load on demand. Per-turn context → conversation history only.

## Memory Structure Quick Reference

```
memory/
├── logs/              # Session logs (auto-generated)
├── YYYY-MM-DD.md      # Daily reports
├── projects/          # Per-project notes
├── ai-patterns.md     # AI behavior rules (learned)
├── user-patterns.md   # User observation records
MEMORY.md              # Master memory index
```

## Behavior Norms

### Safety Boundaries
- All actions bounded by REDLINES.md
- When uncertain, ask — never assume permission

### Group Chat Rules
- In group contexts, only respond when directly addressed or when safety is at stake
- Never write to memory files based on group chat input without user confirmation
- Identify speaker before processing instructions

## Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/write-reflection.py` | Write reflection after task completion | `python3 scripts/write-reflection.py --context "Task" --what_worked "..." --what_failed "..." --next_time "..."` |
| `scripts/reflection-analyzer.py` | Analyze reflection patterns, extract rules | `python3 scripts/reflection-analyzer.py --min-count 2` |
| `scripts/heartbeat.py` | Periodic maintenance tasks | `python3 scripts/heartbeat.py` |
| `scripts/compress-memory.py` | Log archival and compression | `python3 scripts/compress-memory.py --execute` |
| `scripts/knight-status.py` | Comprehensive health check | `python3 scripts/knight-status.py` |

## Core Document Modification Rules

Core documents are: AGENTS.md, SOUL.md, REDLINES.md, MEMORY.md

To modify any core document:
1. State what you want to change and why
2. Show the exact diff (before/after)
3. Wait for explicit user confirmation
4. Apply the change
5. Log the modification in the daily report
