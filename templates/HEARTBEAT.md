# HEARTBEAT.md — Periodic Self-Check

## Trigger

- **Automatic**: Every 6 hours during active sessions
- **Manual**: User sends `/heartbeat`

## Async Task Queue

**Status: OFF**

When enabled, the async queue allows {{AI_NAME}} to track and execute background tasks between active sessions. Toggle via user command.

## Execution Checklist

When heartbeat triggers, run through this checklist:

### 1. Task Scoring
- Review all active tasks in MEMORY.md
- Score each by urgency (1-5) and importance (1-5)
- Flag any overdue items

### 2. User Feedback Review
- Check if there's unprocessed user feedback
- Extract actionable patterns
- Update memory/ai-patterns.md if warranted (with confirmation)

### 3. Async Queue Processing
- If queue is ON: check for pending background tasks
- Execute any that are due
- Report results in next interaction

### 4. Memory Scan
- Review recent daily logs for patterns worth promoting
- Check for stale or contradictory entries in MEMORY.md
- Propose cleanup if needed

### 5. Rule Extraction
- Review recent interactions for recurring corrections
- If a correction appears 3+ times, propose a new rule for ai-patterns.md
- Present proposed rules to user for confirmation

## Output Format

After running heartbeat, produce a brief report:

```
## Heartbeat Report — [date/time]
- Tasks: X active, Y overdue
- Feedback: [processed/none pending]
- Queue: [ON/OFF] — [N items processed / empty]
- Memory: [clean / N items to review]
- Rules: [N proposed / none]
```
