'use strict';

const fs = require('fs');
const path = require('path');
const {
  CURRENT_DATA_VERSION,
  hasExistingMemory,
  readDataVersion,
} = require('./migrate');

const CORE_FILES = [
  'AGENTS.md',
  'SOUL.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'REDLINES.md',
  'USER.md',
  'TOOLS.md',
  'PROJECTS.md',
];

const MEMORY_DIRS = [
  'memory/reflections',
  'memory/logs',
  'memory/projects',
  'memory/references',
  'memory/templates',
];

const BACKUP_DIR = '.knight-backups';
const VERSION_FILE = '.knight-version';
const LOG_LARGE_BYTES = 10 * 1024 * 1024;
const LOG_LARGE_LINES = 5000;
const MEMORY_STALE_DAYS = 14;

function countFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, predicate);
    } else if (!predicate || predicate(fullPath)) {
      count++;
    }
  }
  return count;
}

function directorySizeAndLines(dir) {
  const result = { bytes: 0, lines: 0, files: 0 };
  if (!fs.existsSync(dir)) return result;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      result.files++;
      const stat = fs.statSync(fullPath);
      result.bytes += stat.size;
      if (/\.(jsonl|log|md|txt)$/i.test(entry.name)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          result.lines += content.split(/\r?\n/).length - 1;
        } catch {}
      }
    }
  }

  walk(dir);
  return result;
}

function daysSinceModified(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  const ageMs = Date.now() - stat.mtimeMs;
  return Math.floor(ageMs / (24 * 60 * 60 * 1000));
}

function addResult(results, severity, label, detail, action) {
  results.push({ severity, label, detail, action });
}

function buildDoctorReport(config, workspace) {
  const results = [];
  const nextActions = [];
  let severeFailures = 0;

  if (!fs.existsSync(workspace)) {
    addResult(
      results,
      'fail',
      'Workspace',
      `${workspace} does not exist`,
      'run `knight setup`'
    );
    severeFailures++;
    nextActions.push('run `knight setup`');
    return { results, nextActions, severeFailures };
  }

  addResult(results, 'ok', 'Workspace', workspace);
  const existingMemory = hasExistingMemory(workspace);
  if (existingMemory) {
    addResult(
      results,
      'info',
      'Existing memory compatibility',
      'existing memory/OpenClaw files detected',
      'preview adoption with `knight adopt --plan` before writing'
    );
  }

  const missingCore = [];
  for (const file of CORE_FILES) {
    const exists = fs.existsSync(path.join(workspace, file));
    const action = existingMemory
      ? 'preview safe additions with `knight adopt --plan` or `knight upgrade --plan`'
      : 'run `knight setup` or `knight upgrade --plan`';
    addResult(
      results,
      exists ? 'ok' : 'fail',
      file,
      exists ? 'present' : 'missing',
      exists ? null : action
    );
    if (!exists) missingCore.push(file);
  }
  if (missingCore.length > 0) {
    severeFailures++;
    nextActions.push(
      existingMemory
        ? 'run `knight adopt --plan` to preview safe additions; do not rerun setup unless you intend to initialize a blank workspace'
        : 'run `knight setup` or restore missing core files before continuing'
    );
  }

  const missingDirs = [];
  for (const dir of MEMORY_DIRS) {
    const exists = fs.existsSync(path.join(workspace, dir));
    addResult(
      results,
      exists ? 'ok' : 'warn',
      dir + '/',
      exists ? 'present' : 'missing',
      exists ? null : 'run `knight upgrade --plan`'
    );
    if (!exists) missingDirs.push(dir);
  }
  if (missingDirs.length > 0) {
    nextActions.push('run `knight upgrade --plan` to preview missing memory directories');
  }

  const versionPath = path.join(workspace, VERSION_FILE);
  const hasVersionFile = fs.existsSync(versionPath);
  const dataVersion = readDataVersion(workspace);
  if (!hasVersionFile) {
    addResult(
      results,
      'warn',
      VERSION_FILE,
      `missing, treated as data v${dataVersion}`,
      'run `knight upgrade --plan`'
    );
    nextActions.push('run `knight upgrade --plan` to preview data version bootstrap');
  } else if (dataVersion < CURRENT_DATA_VERSION) {
    addResult(
      results,
      'warn',
      VERSION_FILE,
      `data v${dataVersion}, target v${CURRENT_DATA_VERSION}`,
      'run `knight upgrade --plan`'
    );
    nextActions.push('run `knight upgrade --plan`, then `knight upgrade` if the plan looks right');
  } else {
    addResult(results, 'ok', VERSION_FILE, `data v${dataVersion}`);
  }

  const backupRoot = path.join(workspace, BACKUP_DIR);
  const backupCount = fs.existsSync(backupRoot)
    ? fs.readdirSync(backupRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).length
    : 0;
  addResult(
    results,
    backupCount > 0 ? 'ok' : 'info',
    BACKUP_DIR,
    fs.existsSync(backupRoot) ? `${backupCount} backup(s)` : 'not created yet',
    backupCount > 0 ? 'run `knight rollback --list`' : 'run `knight upgrade` before risky changes'
  );
  if (backupCount > 0) {
    nextActions.push('run `knight rollback --list` to inspect available restore points');
  }

  const reflectionDir = path.join(workspace, 'memory', 'reflections');
  const reflectionCount = countFiles(reflectionDir, (file) => file.endsWith('.jsonl'));
  addResult(
    results,
    reflectionCount > 0 ? 'ok' : 'warn',
    'Reflections',
    `${reflectionCount} reflection log file(s)`,
    reflectionCount > 0 ? null : 'write a reflection after your next completed task'
  );
  if (reflectionCount === 0) {
    nextActions.push('write a reflection after your next completed task');
  }

  const logs = directorySizeAndLines(path.join(workspace, 'memory', 'logs'));
  const logsLarge = logs.bytes > LOG_LARGE_BYTES || logs.lines > LOG_LARGE_LINES;
  addResult(
    results,
    logsLarge ? 'warn' : 'ok',
    'Logs',
    `${logs.files} file(s), ${logs.lines} line(s), ${(logs.bytes / (1024 * 1024)).toFixed(2)} MB`,
    logsLarge ? 'run `python3 scripts/compress-memory.py --execute`' : null
  );
  if (logsLarge) {
    nextActions.push('run `python3 scripts/compress-memory.py --execute` to archive large logs');
  }

  const memoryAge = daysSinceModified(path.join(workspace, 'MEMORY.md'));
  if (memoryAge !== null) {
    const stale = memoryAge > MEMORY_STALE_DAYS;
    addResult(
      results,
      stale ? 'warn' : 'ok',
      'MEMORY.md freshness',
      `last modified ${memoryAge} day(s) ago`,
      stale ? 'review stale MEMORY.md' : null
    );
    if (stale) nextActions.push('review stale MEMORY.md');
  }

  const heartbeat = config.heartbeat || {};
  const heartbeatEnabled = Boolean(heartbeat.enabled);
  addResult(
    results,
    heartbeatEnabled ? 'ok' : 'warn',
    'Heartbeat',
    heartbeatEnabled
      ? `enabled every ${heartbeat.interval_hours || 6}h`
      : 'disabled in config',
    heartbeatEnabled ? null : 'enable heartbeat in knight.config.json or run scripts manually'
  );
  if (!heartbeatEnabled) {
    nextActions.push('enable heartbeat in knight.config.json or run `python3 scripts/heartbeat.py` manually');
  }

  return {
    results,
    nextActions: Array.from(new Set(nextActions)),
    severeFailures,
  };
}

function printDoctorReport(report, workspace) {
  console.log('\nKnight OS Doctor');
  console.log(`Workspace: ${workspace}\n`);

  const icon = {
    ok: '[ok]',
    warn: '[!]',
    fail: '[x]',
    info: '[-]',
  };

  for (const result of report.results) {
    const action = result.action ? ` | next: ${result.action}` : '';
    console.log(`  ${icon[result.severity]} ${result.label}: ${result.detail}${action}`);
  }

  console.log('\nNext actions:');
  if (report.nextActions.length === 0) {
    console.log('  - no action needed');
  } else {
    report.nextActions.forEach((action) => console.log(`  - ${action}`));
  }

  console.log('');
}

function doctor(config, workspace) {
  const report = buildDoctorReport(config, workspace);
  printDoctorReport(report, workspace);
  return report.severeFailures > 0 ? 1 : 0;
}

module.exports = {
  CORE_FILES,
  MEMORY_DIRS,
  buildDoctorReport,
  doctor,
};
