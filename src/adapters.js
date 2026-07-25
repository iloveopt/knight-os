'use strict';

const fs = require('fs');
const path = require('path');
const {
  SOURCE_SPECS,
  findManagedRecord,
  hashContent,
  hashFile,
  readRegistry,
} = require('./federation');

const CORE_FILES = [
  { domain: 'identity', path: '.knight/core/identity.md', title: 'Identity', sources: ['SOUL.md'] },
  { domain: 'user', path: '.knight/core/user.md', title: 'User', sources: ['USER.md'] },
  { domain: 'memory', path: '.knight/core/memory.md', title: 'Memory', sources: ['MEMORY.md', 'memory/user-patterns.md'] },
  { domain: 'rules', path: '.knight/core/rules.md', title: 'Rules', sources: ['REDLINES.md', 'memory/ai-patterns.md'] },
  { domain: 'projects', path: '.knight/core/projects.md', title: 'Projects', sources: ['PROJECTS.md'] },
];

const ADAPTERS = {
  openclaw: { name: 'openclaw', label: 'OpenClaw', primaryPath: 'AGENTS.md', sidecarPath: 'AGENTS.openclaw.md', description: 'OpenClaw instructions pointing to Knight context projections.' },
  claude: { name: 'claude', label: 'Claude', primaryPath: 'CLAUDE.md', sidecarPath: 'CLAUDE.knight.md', description: 'Claude instructions pointing to Knight context projections.' },
  codex: { name: 'codex', label: 'Codex', primaryPath: 'AGENTS.codex.md', sidecarPath: 'AGENTS.codex.knight.md', description: 'Codex instructions kept separate from OpenClaw AGENTS.md.' },
};

function listAdapters() { return Object.values(ADAPTERS); }
function readIfExists(filePath) { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').trimEnd() : null; }
function sourceId(relPath) {
  const spec = SOURCE_SPECS.find((item) => item.path === relPath);
  return spec ? spec.id : relPath.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function buildCoreContent(workspace, spec) {
  const sections = [];
  for (const source of spec.sources) {
    const content = readIfExists(path.join(workspace, source));
    if (content) sections.push(`## Source: ${sourceId(source)} (${source})\n\n${content}`);
  }
  if (spec.domain === 'projects') {
    const projectDir = path.join(workspace, 'memory', 'projects');
    if (fs.existsSync(projectDir)) {
      const names = fs.readdirSync(projectDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
      if (names.length) sections.push(`## Source: projects-directory (memory/projects/)\n\n${names.map((name) => `- ${name}`).join('\n')}`);
    }
  }
  return [
    `# Knight Context Projection: ${spec.title}`,
    '',
    `<!-- Knight-managed projection. Domain: ${spec.domain}. Sources: ${spec.sources.map(sourceId).join(', ')}. -->`,
    '<!-- Read-only generated snapshot. User-owned source files are authoritative. -->',
    '',
    sections.length ? sections.join('\n\n---\n\n') : '_No source content found yet._',
    '',
  ].join('\n');
}

function buildAdapterContent(adapter, vars) {
  const userName = vars.userName || vars.user_name || 'User';
  return [
    `# ${adapter.label} Instructions — Knight Context Adapter`, '',
    `<!-- Knight-managed adapter. Agent: ${adapter.name}. Sources: .knight/core/*.md. -->`,
    '<!-- Edit user-owned sources, then run `knight sync`; do not edit this generated file. -->', '',
    `You are an agent working with ${userName}. Bring your own agent. Keep your context.`, '',
    'Knight is a local-first context hub, not a multi-agent scheduler.', '',
    '## Load Order', '',
    '1. `.knight/core/identity.md`', '2. `.knight/core/user.md`', '3. `.knight/core/rules.md`',
    '4. `.knight/core/memory.md`', '5. `.knight/core/projects.md`', '',
    'Treat `.knight/core/` as read-only context projections. Root memory, identity, rules, and project files remain user-owned sources of truth.', '',
  ].join('\n');
}

function targetState(workspace, registry, relPath, content, kind) {
  const fullPath = path.join(workspace, relPath);
  const exists = fs.existsSync(fullPath);
  const record = findManagedRecord(registry, relPath);
  const desiredHash = hashContent(content);
  if (!exists) return { path: relPath, action: 'create', desiredHash, reason: `${kind} path is available` };
  if (!record) return { path: relPath, action: 'unmanaged', desiredHash, reason: `existing ${kind} is user-owned` };
  const currentHash = hashFile(fullPath);
  const recordedHash = record.generatedHash || record.hash;
  if (!recordedHash || currentHash !== recordedHash) {
    return { path: relPath, action: 'conflict', desiredHash, currentHash, recordedHash, reason: 'managed output changed since generation' };
  }
  if (currentHash === desiredHash) return { path: relPath, action: 'noop', desiredHash, reason: 'generated content unchanged' };
  return { path: relPath, action: 'update', desiredHash, reason: 'managed output is safe to update' };
}

function chooseAdapterTarget(workspace, registry, adapter, content) {
  const primary = targetState(workspace, registry, adapter.primaryPath, content, 'adapter');
  if (primary.action !== 'unmanaged') return primary;
  const sidecar = targetState(workspace, registry, adapter.sidecarPath, content, 'adapter sidecar');
  if (sidecar.action === 'unmanaged') return Object.assign(sidecar, { action: 'conflict', conflict: adapter.primaryPath, reason: 'primary and sidecar are both user-owned' });
  return Object.assign(sidecar, { conflict: adapter.primaryPath });
}

function createSyncPlan(workspace, opts) {
  opts = opts || {};
  const registry = readRegistry(workspace);
  const agents = opts.all ? Object.keys(ADAPTERS) : [opts.agent || ''];
  const invalid = agents.filter((name) => !ADAPTERS[name]);
  if (invalid.length) return { workspace, invalid, core: [], adapters: [] };
  const core = CORE_FILES.map((spec) => {
    const content = buildCoreContent(workspace, spec);
    return Object.assign(targetState(workspace, registry, spec.path, content, 'projection'), spec, { content, sourceIds: spec.sources.map(sourceId) });
  });
  const adapters = agents.map((name) => {
    const adapter = ADAPTERS[name];
    const content = buildAdapterContent(adapter, opts.vars || {});
    return Object.assign(chooseAdapterTarget(workspace, registry, adapter, content), { agent: name, label: adapter.label, content, source: '.knight/core/*' });
  });
  return { workspace, invalid: [], core, adapters, registry };
}

function upsert(items, entry, key) {
  const index = items.findIndex((item) => item[key] === entry[key]);
  if (index === -1) items.push(entry); else items[index] = Object.assign({}, items[index], entry);
}

function currentSources(workspace, priorSources, now) {
  return SOURCE_SPECS.filter((spec) => fs.existsSync(path.join(workspace, spec.path))).map((spec) => {
    const prior = priorSources.find((item) => item.id === spec.id) || {};
    return Object.assign({}, prior, spec, { ownership: 'user', writePolicy: 'never', lastSeenHash: hashFile(path.join(workspace, spec.path)), lastSeenAt: now, driftStatus: 'clean' });
  });
}

function applySyncPlan(plan, opts) {
  opts = opts || {};
  const now = opts.now || new Date().toISOString();
  const packageVersion = opts.packageVersion || '0.5.0';
  const registry = plan.registry || readRegistry(plan.workspace);
  const projections = registry.projections.slice();
  const adapters = registry.adapters.slice();
  const files = registry.files.slice();
  const written = [], unchanged = [], conflicts = [], skipped = [];
  fs.mkdirSync(plan.workspace, { recursive: true });

  for (const item of plan.core.concat(plan.adapters)) {
    if (item.action === 'noop') { unchanged.push(item); continue; }
    if (item.action === 'conflict' || item.action === 'unmanaged') { conflicts.push(item); skipped.push(item); continue; }
    const dest = path.join(plan.workspace, item.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.content, 'utf8');
    written.push(item);
    const base = { path: item.path, ownership: 'knight', generatedHash: item.desiredHash, generatedAt: now, conflictStatus: 'none' };
    if (item.agent) upsert(adapters, Object.assign(base, { agent: item.agent }), 'path');
    else upsert(projections, Object.assign(base, { domain: item.domain, sourceIds: item.sourceIds }), 'path');
    upsert(files, { path: item.path, action: item.action, agent: item.agent || null, managedByKnight: true, userOwned: false, generatedHash: item.desiredHash, updatedAt: now }, 'path');
  }

  let manifestFile = path.join(plan.workspace, '.knight', 'manifest.json');
  if (written.length) {
    const sourceUpdateSafe = !conflicts.some((item) => !item.agent);
    const next = Object.assign({}, registry, {
      schemaVersion: 2,
      version: registry.version || 1,
      sourceTemplateVersion: registry.sourceTemplateVersion || packageVersion,
      adapterLayerVersion: packageVersion,
      updatedAt: now,
      sources: sourceUpdateSafe ? currentSources(plan.workspace, registry.sources, now) : registry.sources,
      projections,
      adapters,
      files,
    });
    if (!next.createdAt) next.createdAt = now;
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }
  return { written, unchanged, conflicts, skipped, manifestPath: manifestFile };
}

function printAdapters() {
  console.log('\nKnight OS Agent Adapters');
  console.log('Bring your own agent. Keep your context. Knight is not a scheduler.\n');
  listAdapters().forEach((adapter) => console.log(`- ${adapter.name}\n  primary: ${adapter.primaryPath}\n  sidecar: ${adapter.sidecarPath}\n  ${adapter.description}`));
  console.log('');
}
function printSyncPlan(plan) {
  console.log(`\nKnight OS Sync Plan\nWorkspace: ${plan.workspace}\n`);
  if (plan.invalid.length) { console.log(`Unknown adapter: ${plan.invalid.join(', ')}\nAvailable adapters: ${Object.keys(ADAPTERS).join(', ')}\n`); return; }
  console.log('projections:'); plan.core.forEach((item) => console.log(`  - ${item.action}: ${item.path} (${item.reason})`));
  console.log('\nadapters:'); plan.adapters.forEach((item) => console.log(`  - ${item.action}: ${item.path} (${item.agent}; ${item.reason})`));
  console.log('\nNo files were changed. To apply this plan, run without `--plan`.\n');
}

module.exports = { ADAPTERS, applySyncPlan, createSyncPlan, listAdapters, printAdapters, printSyncPlan };
