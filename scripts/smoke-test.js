'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pkg = require('../package.json');
const { CURRENT_DATA_VERSION } = require('../src/migrate');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'knight.js');

function run(args, env) {
  return execFileSync(process.execPath, [bin].concat(args), {
    cwd: root,
    env: Object.assign({}, process.env, env),
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
  console.log('smoke tests passed');
}

main();
