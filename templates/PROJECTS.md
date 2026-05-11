# PROJECTS.md — {{AI_NAME}} Project Overview

> Active projects index. Load this file at every session start — keep it short (target: under 40 lines).
> Full context lives in `memory/projects/<name>/main.md` — load on demand when the project is discussed.

---

## Active Projects

| Name | Status | Priority | One-liner |
|------|--------|----------|-----------|
| _(add your first project)_ | 🟢 | — | _(what is this?)_ |

Status: 🟢 Active / 🟡 On Hold / 🔴 Blocked / ✅ Done

---

## Loading Rules

{{AI_NAME}} follows these rules for project context:

| When | Do |
|------|----|
| User mentions a project name | Load `memory/projects/<name>/main.md` |
| Executing a task related to a project | Load main.md + most recent project log |
| Heartbeat / daily review | Scan PROJECTS.md index only (no main.md) |
| Writing daily report | Update main.md → Current Sprint section with today's progress |
| Project not mentioned in session | Do NOT load main.md (save tokens) |

---

## Archived Projects

_(Move completed or abandoned projects here)_

---

## Project File Structure

```
memory/projects/
├── <project-name>/
│   ├── main.md       # Project "workbench" — goals, current sprint, blockers, decisions
│   └── logs/         # Deep history — load only when reviewing past decisions
```

### main.md template

```markdown
# <Project Name>

**Status:** 🟢 Active
**Started:** YYYY-MM-DD
**Goal:** One sentence. What does success look like?

## Current Sprint / This Week
- [ ] Task 1
- [ ] Task 2
_(Update this section at the end of each working session)_

## Open Questions / Blockers
- [YYYY-MM-DD] Question or blocker — owner or resolution

## Next Actions (Top 3)
1.
2.
3.

## Key Decisions
- YYYY-MM-DD: [Decision and rationale]

## Context
[What is this project? Why does it matter? Who is it for?]

## Notes for {{AI_NAME}}
[Anything the AI must remember between sessions — constraints, preferences, gotchas]
```

> Keep main.md under 100 lines. If it grows longer, move older decisions/context to `logs/archive.md`.
