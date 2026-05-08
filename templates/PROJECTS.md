# PROJECTS.md — {{AI_NAME}} Project Overview

> Active projects index. Update when starting or closing a project.
> Detailed notes → `memory/projects/<name>/main.md`

---

## Active Projects

| ID | Name | Status | Priority | Started | Note |
|----|------|--------|----------|---------|------|
| — | _(add your first project)_ | — | — | — | — |

---

## How to Use This File

- One row per project. Keep it scannable.
- Detail goes in `memory/projects/<name>/main.md`
- Status: 🟢 Active / 🟡 On Hold / 🔴 Blocked / ✅ Done

---

## Archived Projects

_(Move completed or abandoned projects here)_

---

## Project File Structure

```
memory/projects/
├── <project-name>/
│   ├── main.md       # Full project context (goals, decisions, roadmap)
│   └── logs/         # Session logs specific to this project
```

### main.md template

```markdown
# <Project Name>

**Status:** 🟢 Active
**Started:** YYYY-MM-DD
**Goal:** One sentence.

## Context
[What is this? Why does it matter?]

## Key Decisions
- YYYY-MM-DD: [Decision and rationale]

## Milestones
- [ ] M1: [Description]
- [ ] M2: [Description]

## Notes
[Anything {{AI_NAME}} should remember between sessions]
```
