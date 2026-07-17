'use strict';

const fs = require('fs');
const path = require('path');
const { renderTemplate } = require('./migrate');

const CORE_FILES = [
  { path: '.knight/core/identity.md', title: 'Identity', sources: ['SOUL.md'] },
  { path: '.knight/core/user.md', title: 'User', sources: ['USER.md'] },
  { path: '.knight/core/memory.md', title: 'Memory', sources: ['MEMORY.md', 'memory/user-patterns.md'] },
  { path: '.knight/core/rules.md', title: 'Rules', sources: ['REDLINES.md', 'memory/ai-patterns.md'] },
  { path: '.knight/core/projects.md', title: 'Projects', sources: ['PROJECTS.md'] },
];

const ADAPTERS = {
  openclaw: {
    name: 'openclaw',
    label: 'OpenClaw',
    primaryPath: 'AGENTS.md',
    sidecarPath: 'AGENTS.openclaw.md',
    description: 'OpenClaw workspace instructions that point at Knight canonical memory.',
  },
  claude: {
    name: 'claude',
    label: 'Claude',
    primaryPath: 'CLAUDE.md',
    sidecarPath: 'CLAUDE.knight.md',
    description: 'Claude-compatible project instructions backed by Knight memory.',
  },
  codex: {
    name: 'codex',
    label: 'Codex',
    primaryPath: 'AGENTS.codex.md',
    sidecarPath: 'AGENTS.codex.knight.md',
    description: 'Codex-compatible instructions kept separate from OpenClaw AGENTS.md.',
  },
};

function listAdapters() {
  return Object.values(ADAPTERS);
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').trimEnd();
}

function readTemplate(templatesDir, relPath, vars) {
  const templatePath = path.join(templatesDir, relPath);
  if (!fs.existsSync(templatePath)) return null;
  return renderTemplate(fs.readFileSync(templatePath, 'utf8'), vars).trimEnd();
}

function buildCoreContent(workspace, templatesDir, spec, vars) {
  const sections = [];
  for (const source of spec.sources) {
    const existing = readIfExists(path.join(workspace, source));
    const fallback = existing === null ? readTemplate(templatesDir, source, vars) : null;
    const content = existing === null ? fallback : existing;
    if (!content) continue;
    sections.push([`## Source: ${source}`, '', content].join('\n'));
  }

  if (spec.path.endsWith('projects.md')) {
    const projectDir = path.join(workspace, 'memory', 'projects');
    if (fs.existsSync(projectDir)) {
      const projects = fs.readdirSync(projectDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (projects.length > 0) {
        sections.push(['## Source: memory/projects/', '', projects.map((name) => `- ${name}`).join('\n')].join('\n'));
      }
    }
  }

  return [
    `# Knight Core: ${spec.title}`,
    '',
    '<!-- Managed by knight-os. Source files remain user-owned. -->',
    '',
    sections.length > 0 ? sections.join('\n\n---\n\n') : '_No source content found yet._',
    '',
  ].join('\n');
}

function buildAdapterContent(adapter, vars) {
  const userName = vars.userName || vars.user_name || 'User';
  const aiName = vars.aiName || vars.ai_name || 'Knight';
  const codexNote = adapter.name === 'codex'
    ? '\nCodex note: this file intentionally uses AGENTS.codex.md so it does not overwrite an OpenClaw AGENTS.md file.\n'
    : '';

  return [
    `# ${adapter.label} Instructions — Knight OS Adapter`,
    '',
    '<!-- Managed by knight-os. Edit the source memory files, then run `knight sync`. -->',
    '',
    `You are an agent working with ${userName}. Knight OS provides the shared memory and identity layer for ${aiName}.`,
    '',
    'Knight is not a multi-agent scheduler. Bring your own agent. Keep one memory.',
    codexNote.trimEnd(),
    '',
    '## Load Order',
    '',
    'Read these canonical Knight memory files before task-specific context:',
    '',
    '1. `.knight/core/identity.md`',
    '2. `.knight/core/user.md`',
    '3. `.knight/core/rules.md`',
    '4. `.knight/core/memory.md`',
    '5. `.knight/core/projects.md`',
    '',
    '## Memory Rules',
    '',
    '- Treat `.knight/core/` as generated canonical context.',
    '- Treat root files such as `SOUL.md`, `USER.md`, `MEMORY.md`, `REDLINES.md`, `PROJECTS.md`, and `memory/*.md` as the user-owned sources of truth.',
    '- Do not overwrite user-owned instruction files while syncing adapters.',
    '- Before writing long-term memory, summarize the intended change and get user confirmation unless an authorized automation path explicitly allows it.',
    '',
  ].filter((line) => line !== undefined).join('\n');
}

function readManifest(workspace) {
  const manifestPath = path.join(workspace, '.knight', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return {};
  }
}

function isManaged(manifest, relPath) {
  return Array.isArray(manifest.files) && manifest.files.some((item) => item.path === relPath && item.managedByKnight);
}

function upsertManifestFile(files, entry) {
  const idx = files.findIndex((item) => item.path === entry.path);
  if (idx === -1) {
    files.push(entry);
    return;
  }
  files[idx] = Object.assign({}, files[idx], entry, {
    createdAt: files[idx].createdAt || entry.createdAt,
  });
}

function writeManifest(workspace, entries, now, packageVersion) {
  const knightDir = path.join(workspace, '.knight');
  fs.mkdirSync(knightDir, { recursive: true });
  const manifestPath = path.join(knightDir, 'manifest.json');
  const manifest = readManifest(workspace);
  const files = Array.isArray(manifest.files) ? manifest.files.slice() : [];

  for (const entry of entries) {
    upsertManifestFile(files, entry);
  }

  const next = Object.assign({}, manifest, {
    version: manifest.version || 1,
    sourceTemplateVersion: manifest.sourceTemplateVersion || packageVersion,
    updatedAt: now,
    adapterLayerVersion: packageVersion,
    files,
  });
  if (!next.createdAt) next.createdAt = now;
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return manifestPath;
}

function chooseAdapterPath(workspace, manifest, adapter) {
  const primary = adapter.primaryPath;
  const sidecar = adapter.sidecarPath;
  const primaryExists = fs.existsSync(path.join(workspace, primary));

  if (!primaryExists || isManaged(manifest, primary)) {
    return {
      path: primary,
      action: primaryExists ? 'update' : 'create',
      reason: primaryExists ? 'managed Knight adapter file' : 'primary adapter path is available',
    };
  }

  const sidecarExists = fs.existsSync(path.join(workspace, sidecar));
  return {
    path: sidecar,
    action: sidecarExists && isManaged(manifest, sidecar) ? 'update' : (sidecarExists ? 'skip' : 'create'),
    reason: sidecarExists
      ? 'sidecar already exists and is not recorded as Knight-managed'
      : `primary path ${primary} already exists`,
    conflict: primary,
  };
}

function chooseCorePath(workspace, manifest, spec) {
  const exists = fs.existsSync(path.join(workspace, spec.path));

  if (!exists || isManaged(manifest, spec.path)) {
    return {
      path: spec.path,
      action: exists ? 'update' : 'create',
      reason: exists ? 'managed Knight core file' : 'core path is available',
    };
  }

  return {
    path: spec.path,
    action: 'skip',
    reason: 'existing unmanaged core file preserved',
  };
}

function createSyncPlan(workspace, opts) {
  opts = opts || {};
  const agent = opts.agent;
  const all = Boolean(opts.all);
  const templatesDir = opts.templatesDir;
  const vars = opts.vars || {};
  const manifest = readManifest(workspace);
  const agents = all ? Object.keys(ADAPTERS) : [agent || ''];

  const invalid = agents.filter((name) => !ADAPTERS[name]);
  if (invalid.length > 0) {
    return { workspace, invalid, core: [], adapters: [], skipped: [] };
  }

  const core = CORE_FILES.map((spec) => {
    const target = chooseCorePath(workspace, manifest, spec);
    return Object.assign({}, target, {
      source: spec.sources.join(', '),
      content: buildCoreContent(workspace, templatesDir, spec, vars),
    });
  });

  const adapters = agents.map((name) => {
    const adapter = ADAPTERS[name];
    const target = chooseAdapterPath(workspace, manifest, adapter);
    return Object.assign({}, target, {
      agent: name,
      label: adapter.label,
      content: buildAdapterContent(adapter, vars),
      source: '.knight/core/*',
    });
  });

  return { workspace, invalid: [], core, adapters };
}

function applySyncPlan(plan, opts) {
  opts = opts || {};
  const packageVersion = opts.packageVersion || '0.4.0';
  const now = opts.now || new Date().toISOString();
  const written = [];
  const skipped = [];

  fs.mkdirSync(plan.workspace, { recursive: true });

  for (const item of plan.core) {
    if (item.action === 'skip') {
      skipped.push(item);
      continue;
    }
    const dest = path.join(plan.workspace, item.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.content, 'utf8');
    written.push(item);
  }

  for (const item of plan.adapters) {
    if (item.action === 'skip') {
      skipped.push(item);
      continue;
    }
    const dest = path.join(plan.workspace, item.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.content, 'utf8');
    written.push(item);
  }

  const manifestEntries = written.map((item) => ({
    path: item.path,
    action: item.action,
    agent: item.agent || null,
    source: item.source || null,
    createdAt: item.action === 'create' ? now : undefined,
    updatedAt: now,
    managedByKnight: true,
    userOwned: false,
    sourceTemplateVersion: packageVersion,
    conflict: item.conflict || null,
  }));

  const manifestPath = writeManifest(plan.workspace, manifestEntries, now, packageVersion);
  return { written, skipped, manifestPath };
}

function printAdapters() {
  console.log('\nKnight OS Agent Adapters');
  console.log('Same memory, multiple agents. Knight is not a scheduler.\n');
  for (const adapter of listAdapters()) {
    console.log(`- ${adapter.name}`);
    console.log(`  primary: ${adapter.primaryPath}`);
    console.log(`  sidecar: ${adapter.sidecarPath}`);
    console.log(`  ${adapter.description}`);
  }
  console.log('');
}

function printSyncPlan(plan) {
  console.log('\nKnight OS Sync Plan');
  console.log(`Workspace: ${plan.workspace}\n`);
  if (plan.invalid.length > 0) {
    console.log(`Unknown adapter: ${plan.invalid.join(', ')}`);
    console.log(`Available adapters: ${Object.keys(ADAPTERS).join(', ')}\n`);
    return;
  }

  console.log('core:');
  plan.core.forEach((item) => {
    const suffix = item.action === 'skip' ? item.reason : `from ${item.source}`;
    console.log(`  - ${item.action}: ${item.path} (${suffix})`);
  });
  console.log('\nadapters:');
  plan.adapters.forEach((item) => {
    const suffix = item.conflict ? `; conflict: ${item.conflict}` : '';
    console.log(`  - ${item.action}: ${item.path} (${item.agent}${suffix})`);
  });
  console.log('\nNo files were changed. To apply this plan, run without `--plan`.\n');
}

module.exports = {
  ADAPTERS,
  applySyncPlan,
  createSyncPlan,
  listAdapters,
  printAdapters,
  printSyncPlan,
};
