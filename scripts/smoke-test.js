'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pkg = require('../package.json');
const { backupWorkspace, CURRENT_DATA_VERSION } = require('../src/migrate');
const { writeSetupTemplates } = require('../src/setup');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'knight.js');

function run(args, env, input) {
  return execFileSync(process.execPath, [bin].concat(args), {
    cwd: root,
    env: Object.assign({}, process.env, env),
    input: input || '',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function snapshotTree(dir) {
  const result = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      const stat = fs.statSync(fullPath);
      result.push({
        path: relPath,
        type: entry.isDirectory() ? 'dir' : 'file',
        size: entry.isDirectory() ? 0 : stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      });
      if (entry.isDirectory()) walk(fullPath);
    }
  }

  walk(dir);
  return JSON.stringify(result.sort((a, b) => a.path.localeCompare(b.path)));
}

function prepareWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-smoke-'));
  const workspace = path.join(tempRoot, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.cpSync(path.join(root, 'templates'), workspace, { recursive: true });

  for (const dir of [
    'memory/reflections',
    'memory/logs',
    'memory/projects',
    'memory/references',
    'memory/templates',
  ]) {
    fs.mkdirSync(path.join(workspace, dir), { recursive: true });
  }

  fs.writeFileSync(path.join(workspace, '.knight-version'), `${CURRENT_DATA_VERSION}\n`);
  return { tempRoot, workspace };
}

function countBackups(workspace) {
  const backupRoot = path.join(workspace, '.knight-backups');
  if (!fs.existsSync(backupRoot)) return 0;
  return fs.readdirSync(backupRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

function main() {
  const version = run(['version']);
  assert.strictEqual(version.trim(), `knight-os v${pkg.version}`);

  const setupSource = fs.readFileSync(path.join(root, 'src', 'setup.js'), 'utf8');
  assert.doesNotMatch(setupSource, /npm['"],\s*\[\s*['"]list['"]/);
  assert.doesNotMatch(setupSource, /npm install -g openclaw/);
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.ok(!pkg[field] || !pkg[field].openclaw, `package.json must not depend on openclaw via ${field}`);
  }

  const { tempRoot, workspace } = prepareWorkspace();
  const env = { KNIGHT_WORKSPACE: workspace };

  const doctor = run(['doctor'], env);
  assert.match(doctor, /Knight OS Doctor/);
  assert.match(doctor, /Next actions:/);

  const beforePlan = snapshotTree(workspace);
  const plan = run(['upgrade', '--plan'], env);
  const afterPlan = snapshotTree(workspace);
  assert.strictEqual(afterPlan, beforePlan, 'upgrade --plan changed the workspace');
  assert.match(plan, /Upgrade Plan/);
  assert.match(plan, /No files were changed/);

  const emptyRollbackList = run(['rollback', '--list'], env);
  assert.match(emptyRollbackList, /No backups found/);

  const backup = path.join(workspace, '.knight-backups', '2026-07-10T12-00-00');
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, 'SOUL.md'), 'old soul\n');
  fs.writeFileSync(path.join(backup, 'AGENTS.md'), 'old agents\n');
  fs.writeFileSync(path.join(backup, 'NOTES.md'), 'old notes\n');

  const beforeDryRun = snapshotTree(workspace);
  const dryRun = run(['rollback', '--dry-run'], env);
  const afterDryRun = snapshotTree(workspace);
  assert.strictEqual(afterDryRun, beforeDryRun, 'rollback --dry-run changed the workspace');
  assert.match(dryRun, /Dry run only/);
  assert.match(dryRun, /Would restore from: 2026-07-10T12-00-00/);
  assert.match(dryRun, /SOUL\.md/);
  assert.match(dryRun, /AGENTS\.md/);

  fs.rmSync(tempRoot, { recursive: true, force: true });

  const tempExistingMemory = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-existing-memory-'));
  const memoryOnlyWorkspace = path.join(tempExistingMemory, 'workspace');
  fs.mkdirSync(memoryOnlyWorkspace, { recursive: true });
  fs.writeFileSync(path.join(memoryOnlyWorkspace, 'MEMORY.md'), 'user memory must stay\n');
  backupWorkspace(memoryOnlyWorkspace);
  writeSetupTemplates(memoryOnlyWorkspace, {
    aiName: 'Knight',
    userName: 'Smoke User',
    timezone: 'UTC',
    language: 'en',
  }, { safeExistingPath: true });
  assert.strictEqual(
    fs.readFileSync(path.join(memoryOnlyWorkspace, 'MEMORY.md'), 'utf8'),
    'user memory must stay\n',
    'setup overwrote existing MEMORY.md'
  );
  assert.ok(fs.existsSync(path.join(memoryOnlyWorkspace, 'AGENTS.md')), 'setup did not add missing AGENTS.md');
  assert.ok(countBackups(memoryOnlyWorkspace) > 0, 'setup did not back up existing memory workspace');
  fs.rmSync(tempExistingMemory, { recursive: true, force: true });

  const tempExistingFiles = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-existing-files-'));
  const existingFilesWorkspace = path.join(tempExistingFiles, 'workspace');
  fs.mkdirSync(path.join(existingFilesWorkspace, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(existingFilesWorkspace, 'AGENTS.md'), 'custom agents\n');
  fs.writeFileSync(path.join(existingFilesWorkspace, 'memory', 'ai-patterns.md'), 'custom ai patterns\n');
  backupWorkspace(existingFilesWorkspace);
  writeSetupTemplates(existingFilesWorkspace, {
    aiName: 'Knight',
    userName: 'Smoke User',
    timezone: 'UTC',
    language: 'en',
  }, { safeExistingPath: true });
  assert.strictEqual(
    fs.readFileSync(path.join(existingFilesWorkspace, 'AGENTS.md'), 'utf8'),
    'custom agents\n',
    'setup overwrote existing AGENTS.md'
  );
  assert.strictEqual(
    fs.readFileSync(path.join(existingFilesWorkspace, 'memory', 'ai-patterns.md'), 'utf8'),
    'custom ai patterns\n',
    'setup overwrote existing memory/ai-patterns.md'
  );
  assert.ok(countBackups(existingFilesWorkspace) > 0, 'setup did not back up existing file workspace');
  fs.rmSync(tempExistingFiles, { recursive: true, force: true });

  const tempAdopt = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-adopt-'));
  const adoptWorkspace = path.join(tempAdopt, 'workspace');
  fs.mkdirSync(path.join(adoptWorkspace, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(adoptWorkspace, 'MEMORY.md'), 'adopt memory\n');
  fs.writeFileSync(path.join(adoptWorkspace, 'AGENTS.md'), 'adopt agents\n');
  fs.writeFileSync(path.join(adoptWorkspace, 'memory', 'ai-patterns.md'), 'adopt ai patterns\n');
  const adoptEnv = { KNIGHT_WORKSPACE: adoptWorkspace };
  const beforeAdoptPlan = snapshotTree(adoptWorkspace);
  const adoptPlan = run(['adopt', '--plan'], adoptEnv);
  const afterAdoptPlan = snapshotTree(adoptWorkspace);
  assert.strictEqual(afterAdoptPlan, beforeAdoptPlan, 'adopt --plan changed the workspace');
  assert.match(adoptPlan, /Adoption Plan/);
  assert.match(adoptPlan, /preserve:/);
  assert.match(adoptPlan, /sidecar:/);

  run(['adopt'], adoptEnv);
  assert.strictEqual(
    fs.readFileSync(path.join(adoptWorkspace, 'AGENTS.md'), 'utf8'),
    'adopt agents\n',
    'adopt overwrote existing AGENTS.md'
  );
  assert.strictEqual(
    fs.readFileSync(path.join(adoptWorkspace, 'memory', 'ai-patterns.md'), 'utf8'),
    'adopt ai patterns\n',
    'adopt overwrote existing memory/ai-patterns.md'
  );
  assert.ok(fs.existsSync(path.join(adoptWorkspace, 'AGENTS.knight.md')), 'adopt did not create AGENTS sidecar');
  assert.ok(
    fs.existsSync(path.join(adoptWorkspace, 'memory', 'knight-ai-patterns.md')),
    'adopt did not create ai-patterns sidecar'
  );
  assert.ok(fs.existsSync(path.join(adoptWorkspace, '.knight', 'manifest.json')), 'adopt did not create manifest');
  assert.ok(
    fs.existsSync(path.join(adoptWorkspace, '.knight', 'adoption-report.md')),
    'adopt did not create adoption report'
  );
  assert.ok(countBackups(adoptWorkspace) > 0, 'adopt did not back up before writing');
  fs.rmSync(tempAdopt, { recursive: true, force: true });

  console.log('smoke tests passed');
}

main();
