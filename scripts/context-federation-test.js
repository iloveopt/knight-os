'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspectWorkspace, getFederationStatus } = require('../src/federation');
const { applySyncPlan, createSyncPlan } = require('../src/adapters');

const root = path.join(__dirname, '..');
const templatesDir = path.join(root, 'templates');
const bin = path.join(root, 'bin', 'knight.js');

function cli(args) {
  return execFileSync(process.execPath, [bin].concat(args), { cwd: root, encoding: 'utf8' });
}

function workspace() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-federation-'));
  return { rootDir, workspace: path.join(rootDir, 'workspace') };
}

function sync(ws, agent, now) {
  const plan = createSyncPlan(ws, { agent, templatesDir, vars: {} });
  return applySyncPlan(plan, { packageVersion: '0.5.0', now });
}

function read(ws, rel) {
  return fs.readFileSync(path.join(ws, rel), 'utf8');
}

function main() {
  const help = cli(['--help']);
  assert.match(help, /inspect\s+Classify context sources/);
  assert.match(help, /status\s+Report source drift/);
  assert.match(help, /--workspace PATH and --json/);

  // Inspection is read-only and unmanaged known files default to user ownership.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'MEMORY.md'), 'user memory\n');
    const before = fs.statSync(path.join(item.workspace, 'MEMORY.md')).mtimeMs;
    const result = inspectWorkspace(item.workspace);
    const cliResult = JSON.parse(cli(['inspect', '--workspace', item.workspace, '--json']));
    assert.deepStrictEqual(cliResult, result);
    const source = result.sources.find((entry) => entry.path === 'MEMORY.md');
    assert.ok(source, 'inspect did not classify MEMORY.md');
    assert.strictEqual(source.domain, 'memory');
    assert.strictEqual(source.ownership, 'user');
    assert.strictEqual(source.writePolicy, 'never');
    assert.strictEqual(fs.statSync(path.join(item.workspace, 'MEMORY.md')).mtimeMs, before);
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // Dynamic memory/*patterns.md sources are projected, registered, and drift-tracked.
  {
    const item = workspace();
    fs.mkdirSync(path.join(item.workspace, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'memory', 'team-patterns.md'), 'team context\n');
    const inspected = inspectWorkspace(item.workspace);
    assert.ok(inspected.sources.some((entry) => entry.path === 'memory/team-patterns.md'));
    sync(item.workspace, 'claude', '2026-07-25T01:00:00.000Z');
    assert.match(read(item.workspace, '.knight/core/memory.md'), /team context/);
    const registry = JSON.parse(read(item.workspace, '.knight/manifest.json'));
    assert.ok(registry.sources.some((entry) => entry.path === 'memory/team-patterns.md'));
    fs.writeFileSync(path.join(item.workspace, 'memory', 'team-patterns.md'), 'changed team context\n');
    assert.ok(getFederationStatus(item.workspace).sourceDrift.some((entry) => entry.path === 'memory/team-patterns.md'));
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // Existing unmanaged adapter is preserved and Knight writes a managed sidecar.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'CLAUDE.md'), 'my instructions\n');
    sync(item.workspace, 'claude', '2026-07-25T01:00:00.000Z');
    assert.strictEqual(read(item.workspace, 'CLAUDE.md'), 'my instructions\n');
    assert.match(read(item.workspace, 'CLAUDE.knight.md'), /Knight-managed adapter/);
    const registry = JSON.parse(read(item.workspace, '.knight/manifest.json'));
    assert.strictEqual(registry.schemaVersion, 2);
    assert.ok(registry.adapters.some((entry) => entry.path === 'CLAUDE.knight.md' && entry.ownership === 'knight'));
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // Repeated sync with unchanged input is a no-op, including registry bytes.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'SOUL.md'), 'identity\n');
    const first = sync(item.workspace, 'claude', '2026-07-25T01:00:00.000Z');
    const manifestBefore = read(item.workspace, '.knight/manifest.json');
    const second = sync(item.workspace, 'claude', '2026-07-25T02:00:00.000Z');
    assert.ok(first.written.length > 0);
    assert.strictEqual(second.written.length, 0);
    assert.ok(second.unchanged.length > 0);
    assert.strictEqual(read(item.workspace, '.knight/manifest.json'), manifestBefore);
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // Source drift is detected against lastSeenHash after a successful sync.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'MEMORY.md'), 'before\n');
    sync(item.workspace, 'claude', '2026-07-25T01:00:00.000Z');
    fs.writeFileSync(path.join(item.workspace, 'MEMORY.md'), 'after\n');
    const status = getFederationStatus(item.workspace);
    assert.ok(status.sourceDrift.some((entry) => entry.path === 'MEMORY.md'));
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // A user-modified managed output is preserved and reported as conflict.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'SOUL.md'), 'identity one\n');
    sync(item.workspace, 'claude', '2026-07-25T01:00:00.000Z');
    fs.writeFileSync(path.join(item.workspace, '.knight/core/identity.md'), 'manual edit\n');
    fs.writeFileSync(path.join(item.workspace, 'SOUL.md'), 'identity two\n');
    const result = sync(item.workspace, 'claude', '2026-07-25T02:00:00.000Z');
    assert.strictEqual(read(item.workspace, '.knight/core/identity.md'), 'manual edit\n');
    assert.ok(result.conflicts.some((entry) => entry.path === '.knight/core/identity.md'));
    const status = getFederationStatus(item.workspace);
    assert.ok(status.outputConflicts.some((entry) => entry.path === '.knight/core/identity.md'));
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  console.log('context federation contract tests passed');
}

main();
