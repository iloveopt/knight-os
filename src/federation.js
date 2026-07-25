'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOURCE_SPECS = [
  { id: 'identity-soul', domain: 'identity', path: 'SOUL.md' },
  { id: 'user-profile', domain: 'user', path: 'USER.md' },
  { id: 'memory-main', domain: 'memory', path: 'MEMORY.md' },
  { id: 'memory-user-patterns', domain: 'memory', path: 'memory/user-patterns.md' },
  { id: 'rules-redlines', domain: 'rules', path: 'REDLINES.md' },
  { id: 'rules-ai-patterns', domain: 'rules', path: 'memory/ai-patterns.md' },
  { id: 'projects-index', domain: 'projects', path: 'PROJECTS.md' },
];

const ADAPTER_PATHS = {
  'AGENTS.md': 'openclaw',
  'AGENTS.openclaw.md': 'openclaw',
  'CLAUDE.md': 'claude',
  'CLAUDE.knight.md': 'claude',
  'AGENTS.codex.md': 'codex',
  'AGENTS.codex.knight.md': 'codex',
};

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  return hashContent(fs.readFileSync(filePath));
}

function manifestPath(workspace) {
  return path.join(workspace, '.knight', 'manifest.json');
}

function readRegistry(workspace) {
  const filePath = manifestPath(workspace);
  let raw = {};
  if (fs.existsSync(filePath)) {
    try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) {}
  }
  return Object.assign({}, raw, {
    schemaVersion: raw.schemaVersion || 1,
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    projections: Array.isArray(raw.projections) ? raw.projections : [],
    adapters: Array.isArray(raw.adapters) ? raw.adapters : [],
    files: Array.isArray(raw.files) ? raw.files : [],
  });
}

function findManagedRecord(registry, relPath) {
  return registry.projections.find((item) => item.path === relPath && item.ownership === 'knight')
    || registry.adapters.find((item) => item.path === relPath && item.ownership === 'knight')
    || registry.files.find((item) => item.path === relPath && item.managedByKnight);
}

function listMemoryPatternSources(workspace) {
  const memoryDir = path.join(workspace, 'memory');
  if (!fs.existsSync(memoryDir)) return [];
  return fs.readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /patterns?\.md$/i.test(entry.name))
    .map((entry) => {
      const relPath = path.posix.join('memory', entry.name);
      const known = SOURCE_SPECS.find((spec) => spec.path === relPath);
      return known || {
        id: `memory-${entry.name.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
        domain: 'memory',
        path: relPath,
      };
    });
}

function inspectWorkspace(workspace) {
  const registry = readRegistry(workspace);
  const byPath = new Map();
  SOURCE_SPECS.concat(listMemoryPatternSources(workspace)).forEach((spec) => byPath.set(spec.path, spec));
  const sources = Array.from(byPath.values())
    .filter((spec) => fs.existsSync(path.join(workspace, spec.path)))
    .map((spec) => ({
      id: spec.id,
      domain: spec.domain,
      path: spec.path,
      ownership: 'user',
      writePolicy: 'never',
      currentHash: hashFile(path.join(workspace, spec.path)),
      registered: registry.sources.some((item) => item.id === spec.id),
    }));

  const adapters = Object.entries(ADAPTER_PATHS)
    .filter(([relPath]) => fs.existsSync(path.join(workspace, relPath)))
    .map(([relPath, agent]) => ({
      agent,
      path: relPath,
      ownership: findManagedRecord(registry, relPath) ? 'knight' : 'user',
      currentHash: hashFile(path.join(workspace, relPath)),
    }));

  const projections = ['identity', 'user', 'memory', 'rules', 'projects']
    .map((domain) => ({ domain, path: `.knight/core/${domain}.md` }))
    .filter((item) => fs.existsSync(path.join(workspace, item.path)))
    .map((item) => Object.assign(item, {
      ownership: findManagedRecord(registry, item.path) ? 'knight' : 'user',
      currentHash: hashFile(path.join(workspace, item.path)),
    }));

  return { workspace, schemaVersion: registry.schemaVersion, sources, projections, adapters };
}

function getFederationStatus(workspace) {
  const registry = readRegistry(workspace);
  const sourceDrift = [];
  const outputConflicts = [];
  const missing = [];

  for (const source of registry.sources) {
    const currentHash = hashFile(path.join(workspace, source.path));
    if (currentHash === null) missing.push({ type: 'source', path: source.path });
    else if (source.lastSeenHash && currentHash !== source.lastSeenHash) {
      sourceDrift.push({ path: source.path, domain: source.domain, expectedHash: source.lastSeenHash, currentHash });
    }
  }
  for (const output of registry.projections.concat(registry.adapters)) {
    const currentHash = hashFile(path.join(workspace, output.path));
    if (currentHash === null) missing.push({ type: output.agent ? 'adapter' : 'projection', path: output.path });
    else if (output.generatedHash && currentHash !== output.generatedHash) {
      outputConflicts.push({ path: output.path, expectedHash: output.generatedHash, currentHash });
    }
  }

  return {
    workspace,
    schemaVersion: registry.schemaVersion,
    sourceDrift,
    outputConflicts,
    missing,
    clean: sourceDrift.length === 0 && outputConflicts.length === 0 && missing.length === 0,
  };
}

module.exports = {
  ADAPTER_PATHS,
  SOURCE_SPECS,
  findManagedRecord,
  getFederationStatus,
  hashContent,
  hashFile,
  inspectWorkspace,
  manifestPath,
  readRegistry,
};
