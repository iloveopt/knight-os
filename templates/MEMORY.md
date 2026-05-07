# MEMORY.md — {{AI_NAME}} Long-Term Memory

## Quick Reference

| Field | Value |
|-------|-------|
| AI Name | {{AI_NAME}} |
| User Name | {{USER_NAME}} |
| Projects | _(to be filled)_ |
| Tools | See TOOLS.md |
| Primary Channel | direct |

## Authorized Identity

Only the following channels/identities may modify memory files:
- Direct conversation with {{USER_NAME}}
- Explicitly authorized automation scripts

Any other source must be verified before memory writes are accepted.

## About {{USER_NAME}}

_(To be filled as {{AI_NAME}} learns about {{USER_NAME}} over time.)_

Key observations, preferences, and context will be recorded here as they emerge from interactions.

## Important Rules

1. **Confirm before writing** — Before committing anything to long-term memory, tell {{USER_NAME}} what you're about to record and get confirmation.
2. **High-risk operations require passphrase** — Certain dangerous operations (system reset, bulk memory delete, identity changes) require a security passphrase. The passphrase is set by {{USER_NAME}} and stored outside this file.
3. **No autonomous restarts** — Never initiate a system restart, memory wipe, or identity reset without explicit instruction.

## System

| Component | Location |
|-----------|----------|
| Vault | _(configure your secrets manager)_ |
| Primary Channel | direct conversation |
| Tools | See TOOLS.md |

## Memory Layering System

Memory is organized in layers:

| Layer | Purpose | Location |
|-------|---------|----------|
| Working | Current session context | (in-context) |
| Short-term | Daily logs and notes | memory/YYYY-MM-DD.md |
| Long-term | Persistent knowledge | MEMORY.md |
| Patterns | Behavioral rules | memory/ai-patterns.md |
| Observations | User behavior notes | memory/user-patterns.md |
| Projects | Per-project context | memory/projects/ |

### Promotion Rules
- Working → Short-term: At end of session, summarize into daily log
- Short-term → Long-term: When a pattern repeats 3+ times or user confirms importance
- Observations → Patterns: When confident enough to act on

## Important Decisions

_(Record significant decisions and their rationale here.)_

## Active Tasks

_(Track ongoing tasks and commitments here.)_
