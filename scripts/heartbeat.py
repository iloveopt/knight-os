#!/usr/bin/env python3
"""
heartbeat.py — Platform-agnostic maintenance scheduler for Knight OS.

Executes periodic maintenance tasks:
  1. Reflection analysis — detect repeated failure patterns
  2. Memory scan — check MEMORY.md staleness
  3. Log compression — check logs directory size

Usage:
  python3 scripts/heartbeat.py
"""

import json
import os
import sys
import subprocess
from datetime import datetime, timezone
from pathlib import Path


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


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def step_reflection_analysis(config) -> str:
    """Run reflection-analyzer.py to detect patterns."""
    log("Step 1: Reflection analysis")
    scripts_dir = Path(__file__).parent
    analyzer = scripts_dir / "reflection-analyzer.py"

    if not analyzer.exists():
        log("  reflection-analyzer.py not found, skipping")
        return "Reflection analysis: script not found"

    try:
        result = subprocess.run(
            [sys.executable, str(analyzer)],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(scripts_dir.parent),
        )
        output = (result.stdout + result.stderr).strip()
        if result.returncode == 0:
            log("  Analysis complete")
            pattern_count = output.count("candidate rule")
            return f"Reflection analysis: complete ({pattern_count} patterns found)" if pattern_count else "Reflection analysis: no patterns"
        else:
            log(f"  Analysis failed: {output[:200]}")
            return f"Reflection analysis: failed"
    except subprocess.TimeoutExpired:
        log("  Analysis timed out")
        return "Reflection analysis: timed out"
    except Exception as e:
        log(f"  Analysis error: {e}")
        return f"Reflection analysis: error"


def step_memory_scan(config) -> str:
    """Check MEMORY.md freshness — warn if older than 7 days."""
    log("Step 2: Memory scan")
    workspace = resolve_workspace(config)
    local_cfg = config.get("storage", {}).get("local", {})
    memory_file = workspace / local_cfg.get("memory_file", "MEMORY.md")

    if not memory_file.exists():
        log("  MEMORY.md not found")
        return "Memory scan: MEMORY.md not found"

    mtime = datetime.fromtimestamp(memory_file.stat().st_mtime, tz=timezone.utc)
    age_days = (datetime.now(timezone.utc) - mtime).days

    if age_days > 7:
        log(f"  MEMORY.md is {age_days} days old — consider updating")
        return f"Memory scan: MEMORY.md is {age_days} days old (consider updating)"
    else:
        log(f"  MEMORY.md is {age_days} days old — fresh")
        return f"Memory scan: MEMORY.md is fresh ({age_days} days old)"


def step_log_compress(config) -> str:
    """Check logs directory size and suggest compression if needed."""
    log("Step 3: Log compression check")
    workspace = resolve_workspace(config)
    local_cfg = config.get("storage", {}).get("local", {})
    logs_dir = workspace / local_cfg.get("logs_dir", "memory/logs")

    if not logs_dir.exists():
        log("  Logs directory not found")
        return "Log compression: no logs directory"

    total_lines = 0
    total_size = 0
    file_count = 0

    for f in logs_dir.iterdir():
        if f.is_file() and f.suffix in (".md", ".log", ".jsonl", ".txt"):
            total_size += f.stat().st_size
            file_count += 1
            try:
                total_lines += sum(1 for _ in open(f, encoding="utf-8", errors="ignore"))
            except OSError:
                pass

    size_mb = total_size / (1024 * 1024)

    if total_lines > 500:
        log(f"  {file_count} log files, {total_lines} lines ({size_mb:.1f} MB) — compression recommended")
        return f"Log compression: {total_lines} lines across {file_count} files — run compress-memory.py"
    else:
        log(f"  {file_count} log files, {total_lines} lines ({size_mb:.1f} MB) — OK")
        return f"Log compression: OK ({total_lines} lines, {size_mb:.1f} MB)"


def send_notification(report: str, config: dict):
    """Send heartbeat report via configured notification backend."""
    notifications = config.get("notifications", {})
    backend = notifications.get("backend", "none")

    if backend == "telegram" or notifications.get("telegram", {}).get("enabled"):
        import urllib.request

        telegram_cfg = notifications.get("telegram", {})
        bot_token = telegram_cfg.get("bot_token", "") or os.environ.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = telegram_cfg.get("chat_id", "") or os.environ.get("TELEGRAM_CHAT_ID", "")

        if bot_token and chat_id:
            payload = {"chat_id": chat_id, "text": report}
            req = urllib.request.Request(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=10):
                    log("  Notification sent via Telegram")
            except Exception as e:
                log(f"  Telegram notification failed: {e}")


def main():
    start = datetime.now()
    log(f"=== Knight Heartbeat started {start.strftime('%Y-%m-%d %H:%M')} ===")

    config = load_config()
    heartbeat_cfg = config.get("heartbeat", {})
    tasks = heartbeat_cfg.get("tasks", ["reflection_analysis", "memory_scan", "log_compress"])

    results = []

    if "reflection_analysis" in tasks:
        results.append(step_reflection_analysis(config))

    if "memory_scan" in tasks:
        results.append(step_memory_scan(config))

    if "log_compress" in tasks:
        results.append(step_log_compress(config))

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    report_lines = [f"[knight] Heartbeat Report — {now_str}", ""]
    for r in results:
        if r:
            report_lines.append(f"  * {r}")

    elapsed = (datetime.now() - start).seconds
    report_lines.append(f"\n  Completed in {elapsed}s")

    report = "\n".join(report_lines)
    print(report)

    send_notification(report, config)

    log(f"=== Knight Heartbeat complete ({elapsed}s) ===")


if __name__ == "__main__":
    main()
