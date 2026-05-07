#!/usr/bin/env python3
"""
reflection-analyzer.py — Analyze reflections for repeated failure patterns.

Usage:
  python3 scripts/reflection-analyzer.py             # Incremental analysis
  python3 scripts/reflection-analyzer.py --dry-run   # Print only, no side effects
  python3 scripts/reflection-analyzer.py --all       # Full analysis (ignore cursor)
  python3 scripts/reflection-analyzer.py --min-count 3  # Adjust threshold (default: 2)

Backends:
  - local (default): reads from {workspace}/memory/reflections/*.jsonl
  - supabase: queries Supabase REST API (requires config)
"""

import json
import os
import sys
import argparse
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict
from typing import Optional


PATTERN_MAP = [
    {
        "id": "db-schema-assumption",
        "label": "Database field assumption",
        "keywords": ["column", "schema", "field", "table", "mapping"],
        "rule": "Verify schema before any DB operation: `SELECT column_name FROM information_schema.columns WHERE table_name='xxx'`",
    },
    {
        "id": "task-status-not-updated",
        "label": "Task status not updated after completion",
        "keywords": ["PATCH", "status", "not updated", "backlog", "task status"],
        "rule": "After task completion, always: write-reflection + update status — both steps must complete together",
    },
    {
        "id": "missing-reflection",
        "label": "Forgot to write reflection",
        "keywords": ["reflection", "forgot", "missing", "not written"],
        "rule": "No reflection = task not complete. Always call write-reflection.py immediately after finishing a task",
    },
    {
        "id": "heartbeat-gap",
        "label": "Heartbeat gap/interruption",
        "keywords": ["gap", "interrupted", "blank", "no record", "heartbeat"],
        "rule": "After a heartbeat gap, explain the reason on next execution. 2+ consecutive gaps require user notification",
    },
    {
        "id": "silent-tool-switch",
        "label": "Silent tool switch after failure",
        "keywords": ["silent", "tool failed", "unreported", "switch"],
        "rule": "When a tool fails, always report: 'X failed, switching to Y' — silence is a violation",
    },
    {
        "id": "read-before-exec",
        "label": "Modify without reading first",
        "keywords": ["read", "file", "confirm", "structure", "before modify"],
        "rule": "Before modifying any file: read first, understand structure, then execute",
    },
    {
        "id": "rule-exists-not-executed",
        "label": "Rule exists but not followed",
        "keywords": ["rule exists", "known but", "not executed", "upgrade"],
        "rule": "When a rule exists but wasn't followed, escalate its priority to mandatory trigger",
    },
    {
        "id": "blocked-task-not-surfaced",
        "label": "Blocked task not surfaced",
        "keywords": ["blocked", "waiting", "needs confirmation", "cannot close"],
        "rule": "Blocked tasks must be surfaced every heartbeat — never let them accumulate silently",
    },
]


def load_config():
    config_paths = [
        Path.cwd() / "knight.config.json",
        Path.home() / ".knight" / "config.json",
    ]
    for p in config_paths:
        if p.exists():
            try:
                return json.loads(p.read_text())
            except (json.JSONDecodeError, OSError):
                pass
    return {}


def resolve_workspace(config):
    ws = config.get("workspace", "~/.openclaw/workspace")
    return Path(ws).expanduser()


def get_cursor_path(config):
    workspace = resolve_workspace(config)
    return workspace / ".knight-reflection-cursor"


def read_cursor(config) -> Optional[str]:
    cursor_file = get_cursor_path(config)
    if cursor_file.exists():
        return cursor_file.read_text().strip() or None
    return None


def write_cursor(config, ts: str):
    cursor_file = get_cursor_path(config)
    cursor_file.write_text(ts)


def fetch_local(config, since: Optional[str]) -> list:
    """Read reflections from local .jsonl files."""
    workspace = resolve_workspace(config)
    local_cfg = config.get("storage", {}).get("local", {})
    reflections_dir = workspace / local_cfg.get("reflections_dir", "memory/reflections")

    if not reflections_dir.exists():
        return []

    rows = []
    for jsonl_file in sorted(reflections_dir.glob("*.jsonl")):
        with open(jsonl_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    if since and row.get("created_at", "") <= since:
                        continue
                    rows.append(row)
                except json.JSONDecodeError:
                    continue
    return rows


def fetch_supabase(config, since: Optional[str]) -> list:
    """Fetch reflections from Supabase REST API."""
    supabase_cfg = config.get("storage", {}).get("supabase", {})
    url = supabase_cfg.get("url", "")
    key = supabase_cfg.get("service_key", "") or os.environ.get("SUPABASE_SERVICE_KEY", "")

    if not url or not key:
        print("Error: Supabase URL or key not configured.", file=sys.stderr)
        sys.exit(1)

    params = "select=id,created_at,context,what_failed,next_time,confidence&order=created_at.asc&limit=200"
    if since:
        ts = since.replace("+", "%2B").replace(":", "%3A")
        params += f"&created_at=gt.{ts}"

    req = urllib.request.Request(
        f"{url}/rest/v1/reflections?{params}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except Exception as e:
        print(f"Error: Supabase query failed: {e}", file=sys.stderr)
        sys.exit(1)


def analyze(rows: list, min_count: int) -> list:
    hits = defaultdict(list)

    for row in rows:
        text = " ".join([
            row.get("what_failed") or "",
            row.get("next_time") or "",
            row.get("context") or "",
        ]).lower()

        for p in PATTERN_MAP:
            for kw in p["keywords"]:
                if re.search(kw.lower(), text):
                    hits[p["id"]].append(row)
                    break

    candidates = []
    for p in PATTERN_MAP:
        matched = hits[p["id"]]
        if len(matched) >= min_count:
            candidates.append({
                "pattern": p,
                "count": len(matched),
                "examples": matched[:2],
            })

    candidates.sort(key=lambda x: -x["count"])
    return candidates


def format_console(candidates: list, rows: list, since: Optional[str]) -> str:
    scope = f"since {since[:10]}" if since else "all data"
    lines = [f"\n[knight] Reflection Analyzer | {scope} | {len(rows)} entries"]

    if not candidates:
        lines.append("  No repeated failure patterns found — system stable")
    else:
        lines.append(f"  Found {len(candidates)} candidate rules:\n")
        for i, c in enumerate(candidates, 1):
            p = c["pattern"]
            lines.append(f"  [{i}] {p['label']} x {c['count']} times")
            lines.append(f"      Rule: {p['rule']}")
            for ex in c["examples"]:
                snippet = (ex.get("what_failed") or "")[:60]
                lines.append(f"      Example: \"{snippet}...\"")
            lines.append("")

    return "\n".join(lines)


def format_notification(candidates: list, rows: list, since: Optional[str], config: dict) -> Optional[str]:
    if not candidates:
        return None

    user_name = config.get("user_name", "User")
    scope = f"since {since[:10]}" if since else "all data"
    lines = [
        f"[knight] Reflection Analysis | {scope} | {len(rows)} entries",
        f"Found {len(candidates)} repeated failure patterns — suggest writing to ai-patterns.md\n",
    ]

    for i, c in enumerate(candidates, 1):
        p = c["pattern"]
        lines.append(f"{i}. {p['label']} x {c['count']} times")
        lines.append(f"   Rule: {p['rule']}")
        ex = c["examples"][0]
        snippet = (ex.get("what_failed") or "")[:50]
        lines.append(f"   Recent: \"{snippet}\"\n")

    lines.append(f"Reply 'write' to add to ai-patterns.md / 'skip' to ignore")
    return "\n".join(lines)


def send_telegram(text: str, config: dict):
    telegram_cfg = config.get("notifications", {}).get("telegram", {})
    bot_token = telegram_cfg.get("bot_token", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = telegram_cfg.get("chat_id", "") or os.environ.get("TELEGRAM_CHAT_ID", "")

    if not bot_token or not chat_id:
        print("  Warning: Telegram not configured, skipping notification", file=sys.stderr)
        return

    payload = {"chat_id": chat_id, "text": text}
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/sendMessage",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = json.load(r)
            if resp.get("ok"):
                print("  Telegram notification sent")
            else:
                print(f"  Telegram failed: {resp}", file=sys.stderr)
    except Exception as e:
        print(f"  Telegram error: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Analyze reflections for repeated failure patterns.")
    parser.add_argument("--dry-run", action="store_true", help="Print only, no side effects")
    parser.add_argument("--all", action="store_true", help="Analyze all data (ignore cursor)")
    parser.add_argument("--min-count", type=int, default=2, help="Trigger threshold (default: 2)")
    args = parser.parse_args()

    config = load_config()
    min_count = config.get("reflection", {}).get("min_pattern_count", args.min_count)
    if args.min_count != 2:
        min_count = args.min_count

    since = None if args.all else read_cursor(config)
    scope_desc = "all data" if not since else f"since {since[:10]}"
    print(f"[knight] Analysis scope: {scope_desc}")

    storage_cfg = config.get("storage", {})
    backend = storage_cfg.get("backend", "local")

    if backend == "supabase" or storage_cfg.get("supabase", {}).get("enabled"):
        rows = fetch_supabase(config, since)
    else:
        rows = fetch_local(config, since)

    print(f"  Read {len(rows)} reflections")

    if not rows:
        print("  No new data, skipping analysis")
        return

    candidates = analyze(rows, min_count)
    print(format_console(candidates, rows, since))

    latest_ts = rows[-1].get("created_at", datetime.now(timezone.utc).isoformat())
    if not args.dry_run:
        write_cursor(config, latest_ts)
        print(f"  Cursor updated to {latest_ts[:16]}")

    if candidates and not args.dry_run:
        notifications_cfg = config.get("notifications", {})
        if notifications_cfg.get("telegram", {}).get("enabled"):
            msg = format_notification(candidates, rows, since, config)
            if msg:
                send_telegram(msg, config)
    elif args.dry_run:
        print("\n  [dry-run: no cursor update, no notifications]")


if __name__ == "__main__":
    main()
