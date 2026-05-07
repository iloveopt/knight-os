# TOOLS.md — Tool Reference & Configuration

## Must-Remember Rules

| Category | Rule |
|----------|------|
| Search | Always prefer structured search over free-text when available |
| Web | Verify URLs before sharing — never fabricate links |
| Reminders | Include timezone when setting time-based reminders |
| Domains | Never make DNS changes without explicit confirmation |

## Credential Reference

> Never store actual credentials here. This table points to WHERE credentials are stored.

| Service | Credential Location |
|---------|-------------------|
| AI Provider | _(vault path or env var name)_ |
| Email | _(vault path or env var name)_ |
| Calendar | _(vault path or env var name)_ |
| Code Hosting | _(vault path or env var name)_ |
| Cloud Provider | _(vault path or env var name)_ |
| Communication | _(vault path or env var name)_ |
| Database | _(vault path or env var name)_ |
| Monitoring | _(vault path or env var name)_ |

## On-Demand Tool Loading

Tools are loaded only when needed. The following table maps triggers to tool activation:

| Trigger | Tool | Action |
|---------|------|--------|
| User mentions scheduling | Calendar | Load calendar integration |
| User shares a URL | Web Reader | Fetch and parse content |
| User asks about code | Code Tools | Load repo context |
| User mentions email | Email | Load email integration |
| User asks for a reminder | Reminders | Load reminder system |
| File operation requested | File System | Load FS tools |
| User mentions deployment | Cloud/CI | Load deployment tools |

## Tool Usage Notes

_(Add notes about specific tool behaviors, quirks, or limitations as they are discovered.)_
