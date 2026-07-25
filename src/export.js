'use strict';

const fs = require('fs');
const path = require('path');
const { createSyncPlan } = require('./adapters');

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

function exportClaudeHandoff(workspace, output, opts) {
  opts = opts || {};
  workspace = path.resolve(workspace);
  output = path.resolve(output);
  assertSafeExportPaths(workspace, output);

  const plan = createSyncPlan(workspace, {
    agent: 'claude',
    vars: opts.vars || {},
  });
  const adapter = plan.adapters[0];
  const now = opts.now || new Date().toISOString();
  const packageVersion = opts.packageVersion || '0.5.0';
  const outputExisted = fs.existsSync(output);

  try {
    fs.mkdirSync(path.join(output, '.knight', 'core'), { recursive: true });
    for (const item of plan.core) {
      fs.writeFileSync(path.join(output, item.path), item.content, 'utf8');
    }
    fs.writeFileSync(path.join(output, 'CLAUDE.md'), adapter.content, 'utf8');

    const manifest = {
      schemaVersion: 2,
      version: 1,
      export: {
        format: 'claude-handoff',
        projectionOnly: true,
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
        agent: 'claude',
        path: 'CLAUDE.md',
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
      '# Knight OS Claude Code Handoff',
      '',
      'Open this directory in Claude Code. `CLAUDE.md` loads the generated context projections in `.knight/core/`.',
      '',
      'This bundle is projection-only. It intentionally excludes raw memory logs, credentials, contracts, and arbitrary source files.',
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
    files: ['CLAUDE.md', 'README.md', '.knight/manifest.json'].concat(plan.core.map((item) => item.path)),
  };
}

module.exports = { exportClaudeHandoff };
