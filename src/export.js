'use strict';

const fs = require('fs');
const path = require('path');
const { ADAPTERS, createSyncPlan } = require('./adapters');

function isDirectoryEmpty(dirPath) {
  return fs.readdirSync(dirPath).length === 0;
}

function assertSafeExportPaths(workspace, output) {
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`Source workspace does not exist or is not a directory: ${workspace}`);
  }

  const relative = path.relative(workspace, output);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Export output must be outside the source workspace');
  }

  if (fs.existsSync(output)) {
    if (!fs.statSync(output).isDirectory()) {
      throw new Error(`Export output already exists and is not a directory: ${output}`);
    }
    if (!isDirectoryEmpty(output)) {
      throw new Error(`Export output directory is not empty; refusing to overwrite: ${output}`);
    }
  }
}

const PROJECT_INCLUDE_FILES = ['main.md', 'context-snapshot.md'];

function toVisibleContextPath(relativePath) {
  if (relativePath.startsWith('.knight/core/')) {
    return path.join('context', 'core', path.basename(relativePath));
  }
  if (relativePath.startsWith('memory/projects/')) {
    return path.join('context', 'projects', relativePath.slice('memory/projects/'.length));
  }
  return null;
}

function normalizeIncludedProjects(projects) {
  if (!projects) return [];
  const values = Array.isArray(projects) ? projects : [projects];
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('Invalid project include: project name is required');
    }
    const name = value.trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ||
      name.includes('..') ||
      name.includes('/') ||
      name.includes('\\') ||
      path.isAbsolute(name)
    ) {
      throw new Error(`Invalid project include: ${value}`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      normalized.push(name);
    }
  }

  return normalized;
}

function copyIncludedProjectFiles(workspace, output, projectNames) {
  const copied = [];
  const projectsRoot = path.join(workspace, 'memory', 'projects');
  if (!fs.existsSync(projectsRoot)) return copied;

  const realProjectsRoot = fs.realpathSync(projectsRoot);

  for (const projectName of projectNames) {
    const projectDir = path.join(projectsRoot, projectName);
    const projectRelativeDir = path.join('memory', 'projects', projectName);

    for (const fileName of PROJECT_INCLUDE_FILES) {
      const source = path.join(projectDir, fileName);
      if (!fs.existsSync(source)) continue;

      const stat = fs.lstatSync(source);
      if (!stat.isFile()) continue;

      const realSource = fs.realpathSync(source);
      const sourceRelativeToProjects = path.relative(realProjectsRoot, realSource);
      if (sourceRelativeToProjects.startsWith('..') || path.isAbsolute(sourceRelativeToProjects)) {
        throw new Error(`Invalid project include: ${projectName} resolves outside memory/projects`);
      }

      const relativePath = path.join(projectRelativeDir, fileName);
      const destination = path.join(output, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      copied.push(relativePath);
    }
  }

  return copied;
}

function writeVisibleContextMirror(output, plan, includedProjectFiles) {
  const visibleFiles = [];

  for (const item of plan.core) {
    const visiblePath = toVisibleContextPath(item.path);
    if (!visiblePath) continue;
    const destination = path.join(output, visiblePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.content, 'utf8');
    visibleFiles.push(visiblePath);
  }

  for (const relativePath of includedProjectFiles) {
    const visiblePath = toVisibleContextPath(relativePath);
    if (!visiblePath) continue;
    const source = path.join(output, relativePath);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(output, visiblePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    visibleFiles.push(visiblePath);
  }

  return visibleFiles;
}

function exportAgentHandoff(agent, workspace, output, opts) {
  opts = opts || {};
  workspace = path.resolve(workspace);
  output = path.resolve(output);
  const includeProjects = normalizeIncludedProjects(opts.includeProjects);
  assertSafeExportPaths(workspace, output);

  const plan = createSyncPlan(workspace, {
    agent,
    vars: opts.vars || {},
  });
  const adapter = plan.adapters[0];
  // The output directory is empty by contract, so use the agent's canonical entry
  // rather than a source-workspace sidecar selected to protect user-owned files.
  const adapterPath = ADAPTERS[agent].primaryPath;
  const agentLabel = adapter.label;
  const now = opts.now || new Date().toISOString();
  const packageVersion = opts.packageVersion || '0.5.1';
  const outputExisted = fs.existsSync(output);
  let includedProjectFiles = [];
  let visibleFiles = [];

  try {
    fs.mkdirSync(path.join(output, '.knight', 'core'), { recursive: true });
    for (const item of plan.core) {
      fs.writeFileSync(path.join(output, item.path), item.content, 'utf8');
    }
    fs.writeFileSync(path.join(output, adapterPath), adapter.content, 'utf8');
    includedProjectFiles = copyIncludedProjectFiles(workspace, output, includeProjects);
    if (opts.visible) {
      visibleFiles = writeVisibleContextMirror(output, plan, includedProjectFiles);
    }

    const manifest = {
      schemaVersion: 2,
      version: 1,
      export: {
        format: `${agent}-handoff`,
        projectionOnly: includeProjects.length === 0,
        includeProjects,
        includedProjectFiles,
        visible: !!opts.visible,
        visibleFiles,
        createdAt: now,
        knightVersion: packageVersion,
      },
      sources: [],
      projections: plan.core.map((item) => ({
        domain: item.domain,
        path: item.path,
        ownership: 'knight',
        sourceIds: item.sourceIds,
        generatedHash: item.desiredHash,
        generatedAt: now,
      })),
      adapters: [{
        agent,
        path: adapterPath,
        ownership: 'knight',
        generatedHash: adapter.desiredHash,
        generatedAt: now,
      }],
      files: [],
    };
    fs.writeFileSync(
      path.join(output, '.knight', 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(output, 'README.md'), [
      `# Knight OS ${agentLabel} Handoff`,
      '',
      `Open this directory as a ${agentLabel} workspace. \`${adapterPath}\` loads the generated context projections in \`.knight/core/\`.`,
      '',
      opts.visible
        ? 'Human-readable review copies are available in `context/`. The `.knight/` files remain the canonical agent context.'
        : 'Run export with `--visible` to add human-readable review copies in `context/`.',
      '',
      includeProjects.length
        ? 'This bundle includes generated projections plus the explicitly selected project context files listed in `.knight/manifest.json`.'
        : 'This bundle is projection-only. It intentionally excludes raw memory logs, credentials, contracts, and arbitrary source files.',
      '',
      'Selected project includes are limited to `memory/projects/<name>/main.md` and `memory/projects/<name>/context-snapshot.md` when those files exist.',
      '',
      'To refresh it, export to a new empty directory from the source workspace.',
      '',
    ].join('\n'), 'utf8');
  } catch (error) {
    if (!outputExisted) fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }

  return {
    workspace,
    output,
    files: [adapterPath, 'README.md', '.knight/manifest.json']
      .concat(plan.core.map((item) => item.path))
      .concat(includedProjectFiles)
      .concat(visibleFiles),
  };
}

function exportClaudeHandoff(workspace, output, opts) {
  return exportAgentHandoff('claude', workspace, output, opts);
}

function exportHermesHandoff(workspace, output, opts) {
  return exportAgentHandoff('hermes', workspace, output, opts);
}

module.exports = { exportAgentHandoff, exportClaudeHandoff, exportHermesHandoff };
