'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { inspectWorkspace, getFederationStatus } = require('../src/federation');
const { applySyncPlan, createSyncPlan } = require('../src/adapters');

const root = path.join(__dirname, '..');
const templatesDir = path.join(root, 'templates');
const bin = path.join(root, 'bin', 'knight.js');

function cli(args, options) {
  return execFileSync(process.execPath, [bin].concat(args), Object.assign({ cwd: root, encoding: 'utf8' }, options));
}

function cliResult(args, options) {
  return spawnSync(process.execPath, [bin].concat(args), Object.assign({ cwd: root, encoding: 'utf8' }, options));
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

  // sync honors --workspace without requiring KNIGHT_WORKSPACE.
  {
    const item = workspace();
    fs.mkdirSync(item.workspace, { recursive: true });
    fs.writeFileSync(path.join(item.workspace, 'SOUL.md'), 'explicit workspace identity\n');
    const env = Object.assign({}, process.env);
    delete env.KNIGHT_WORKSPACE;
    const plan = cli(['sync', '--workspace', item.workspace, '--agent', 'claude', '--plan'], { env });
    assert.match(plan, new RegExp(`Workspace: ${item.workspace.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
    cli(['sync', '--workspace', item.workspace, '--agent', 'claude'], { env });
    assert.match(read(item.workspace, '.knight/core/identity.md'), /explicit workspace identity/);
    fs.rmSync(item.rootDir, { recursive: true, force: true });
  }

  // A Claude export is projection-only, preserves source files, and fails on non-empty output.
  {
    const item = workspace();
    const output = path.join(item.rootDir, 'handoff');
    fs.mkdirSync(path.join(item.workspace, 'memory'), { recursive: true });
    const fixtures = {
      'SOUL.md': '# Noa identity\n',
      'USER.md': '# Steve profile\n',
      'MEMORY.md': '# Curated memory\n',
      'REDLINES.md': '# Safety rules\n',
      'PROJECTS.md': '# Knight OS\n',
      'memory/custom-patterns.md': 'Always preserve evidence.\n',
      'memory/2026-07-25.md': 'raw private daily log\n',
      'memory/projects/knight/main.md': '# Knight task context\n',
      'memory/projects/knight/context-snapshot.md': '# Knight snapshot\n',
      'memory/projects/knight/private-notes.md': 'do not export arbitrary project files\n',
      'memory/projects/arti/main.md': '# Arti context\n',
      'CLAUDE.md': '# Existing user instructions\n',
      '.env': 'ANTHROPIC_API_KEY=secret-value\n',
      'contract.pdf': 'private contract\n',
    };
    for (const [relPath, content] of Object.entries(fixtures)) {
      fs.mkdirSync(path.dirname(path.join(item.workspace, relPath)), { recursive: true });
      fs.writeFileSync(path.join(item.workspace, relPath), content);
    }
    const before = Object.fromEntries(Object.keys(fixtures).map((relPath) => [relPath, read(item.workspace, relPath)]));

    cli(['export', 'claude', '--workspace', item.workspace, '--output', output]);

    assert.ok(fs.existsSync(path.join(output, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(output, 'README.md')));
    assert.ok(fs.existsSync(path.join(output, '.knight/manifest.json')));
    for (const domain of ['identity', 'user', 'memory', 'rules', 'projects']) {
      assert.ok(fs.existsSync(path.join(output, `.knight/core/${domain}.md`)));
    }
    assert.match(read(output, 'CLAUDE.md'), /\.knight\/core\/identity\.md/);
    assert.match(read(output, '.knight/core/memory.md'), /Always preserve evidence/);
    assert.deepStrictEqual(
      Object.fromEntries(Object.keys(fixtures).map((relPath) => [relPath, read(item.workspace, relPath)])),
      before
    );
    assert.ok(!fs.existsSync(path.join(output, '.env')));
    assert.ok(!fs.existsSync(path.join(output, 'memory/2026-07-25.md')));
    assert.ok(!fs.existsSync(path.join(output, 'memory/projects/knight/main.md')));
    assert.ok(!fs.existsSync(path.join(output, 'context/core/identity.md')));
    assert.ok(!fs.existsSync(path.join(output, 'contract.pdf')));
    assert.ok(!read(output, '.knight/core/memory.md').includes('raw private daily log'));
    assert.ok(!read(output, '.knight/manifest.json').includes('secret-value'));

    const projectOutput = path.join(item.rootDir, 'handoff-project');
    cli(['export', 'claude', '--workspace', item.workspace, '--output', projectOutput, '--include-project', 'knight']);
    assert.strictEqual(read(projectOutput, 'memory/projects/knight/main.md'), '# Knight task context\n');
    assert.strictEqual(read(projectOutput, 'memory/projects/knight/context-snapshot.md'), '# Knight snapshot\n');
    assert.ok(!fs.existsSync(path.join(projectOutput, 'memory/projects/knight/private-notes.md')));
    assert.ok(!fs.existsSync(path.join(projectOutput, 'memory/projects/arti/main.md')));
    assert.ok(!fs.existsSync(path.join(projectOutput, 'memory/2026-07-25.md')));
    assert.ok(!read(projectOutput, '.knight/manifest.json').includes('secret-value'));

    const visibleOutput = path.join(item.rootDir, 'handoff-visible');
    cli(['export', 'claude', '--workspace', item.workspace, '--output', visibleOutput, '--include-project', 'knight', '--visible']);
    assert.strictEqual(read(visibleOutput, 'context/core/identity.md'), read(visibleOutput, '.knight/core/identity.md'));
    assert.strictEqual(read(visibleOutput, 'context/projects/knight/main.md'), '# Knight task context\n');
    assert.strictEqual(read(visibleOutput, 'context/projects/knight/context-snapshot.md'), '# Knight snapshot\n');
    assert.ok(!fs.existsSync(path.join(visibleOutput, 'context/projects/knight/private-notes.md')));
    const visibleManifest = JSON.parse(read(visibleOutput, '.knight/manifest.json'));
    assert.strictEqual(visibleManifest.export.visible, true);
    assert.ok(visibleManifest.export.visibleFiles.includes('context/core/identity.md'));
    assert.ok(visibleManifest.export.visibleFiles.includes('context/projects/knight/main.md'));
    assert.ok(!read(visibleOutput, '.knight/manifest.json').includes('secret-value'));

    const invalidOutput = path.join(item.rootDir, 'handoff-invalid');
    const invalid = cliResult(['export', 'claude', '--workspace', item.workspace, '--output', invalidOutput, '--include-project', '../secrets']);
    assert.notStrictEqual(invalid.status, 0);
    assert.match(invalid.stderr, /invalid project/i);
    assert.ok(!fs.existsSync(path.join(item.rootDir, 'secrets')));
    const absoluteInvalid = cliResult(['export', 'claude', '--workspace', item.workspace, '--output', path.join(item.rootDir, 'handoff-absolute-invalid'), '--include-project', '/tmp/x']);
    assert.notStrictEqual(absoluteInvalid.status, 0);
    assert.match(absoluteInvalid.stderr, /invalid project/i);

    const externalProject = path.join(item.rootDir, 'external-project');
    fs.mkdirSync(externalProject, { recursive: true });
    fs.writeFileSync(path.join(externalProject, 'main.md'), 'external project context\n');
    fs.rmSync(path.join(item.workspace, 'memory/projects/knight'), { recursive: true, force: true });
    fs.symlinkSync(externalProject, path.join(item.workspace, 'memory/projects/knight'), 'dir');
    const symlinkInvalid = cliResult(['export', 'claude', '--workspace', item.workspace, '--output', path.join(item.rootDir, 'handoff-symlink-invalid'), '--include-project', 'knight']);
    assert.notStrictEqual(symlinkInvalid.status, 0);
    assert.match(symlinkInvalid.stderr, /outside memory\/projects/i);

    const repeated = cliResult(['export', 'claude', '--workspace', item.workspace, '--output', output]);
    assert.notStrictEqual(repeated.status, 0);
    assert.match(repeated.stderr, /not empty/i);
    assert.strictEqual(read(output, 'CLAUDE.md').includes('Knight Context Adapter'), true);
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
