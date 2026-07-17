'use strict';

const fs = require('fs');
const path = require('path');
const {
  backupWorkspace,
  deepMergeMissing,
  hasExistingMemory,
  renderTemplate,
} = require('./migrate');

const SIDECAR_PATHS = {
  'AGENTS.md': 'AGENTS.knight.md',
  'PROJECTS.md': 'PROJECTS.knight.md',
  'memory/ai-patterns.md': 'memory/knight-ai-patterns.md',
  'memory/user-patterns.md': 'memory/knight-user-patterns.md',
};

const MEMORY_DIRS = [
  'memory',
  'memory/reflections',
  'memory/logs',
  'memory/projects',
  'memory/references',
  'memory/templates',
  'output',
  'scripts',
  '.knight',
];

function listFiles(dir, base) {
  base = base || dir;
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(listFiles(fullPath, base));
    } else {
      results.push(path.relative(base, fullPath));
    }
  }
  return results.sort();
}

function defaultConfig(workspace, vars) {
  return {
    workspace,
    ai_name: vars.aiName || vars.ai_name || 'Knight',
    user_name: vars.userName || vars.user_name || 'User',
    timezone: vars.timezone || 'UTC',
    storage: {
      backend: 'local',
      local: {
        reflections_dir: 'memory/reflections',
        logs_dir: 'memory/logs',
        memory_file: 'MEMORY.md',
      },
      supabase: { url: '', service_key: '', enabled: false },
    },
    notifications: {
      backend: 'none',
      telegram: { bot_token: '', chat_id: '', enabled: false },
    },
    heartbeat: {
      interval_hours: 6,
      enabled: false,
      tasks: ['reflection_analysis', 'memory_scan', 'log_compress'],
    },
    reflection: { min_pattern_count: 2, auto_write: true },
    model: {
      provider: 'anthropic',
      name: 'claude-sonnet-4-5',
      max_tokens: 8096,
      system_prompt_files: ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'REDLINES.md'],
    },
  };
}

function makeItem(pathName, reason, extra) {
  return Object.assign({ path: pathName, reason }, extra || {});
}

function createAdoptionPlan(workspace, opts) {
  opts = opts || {};
  const templatesDir = opts.templatesDir;
  const scriptsDir = opts.scriptsDir;
  const packageVersion = opts.packageVersion || '0.3.0';
  const preserve = [];
  const add = [];
  const sidecar = [];
  const manual = [];

  for (const dir of MEMORY_DIRS) {
    if (fs.existsSync(path.join(workspace, dir))) {
      preserve.push(makeItem(dir + '/', 'directory already exists'));
    } else {
      add.push(makeItem(dir + '/', 'missing Knight workspace directory', { type: 'directory' }));
    }
  }

  for (const relPath of listFiles(templatesDir)) {
    const dest = path.join(workspace, relPath);
    if (!fs.existsSync(dest)) {
      add.push(makeItem(relPath, 'missing Knight template', { type: 'template', source: relPath }));
      continue;
    }

    if (SIDECAR_PATHS[relPath]) {
      const sidecarPath = SIDECAR_PATHS[relPath];
      preserve.push(makeItem(relPath, 'existing user-owned file'));
      if (fs.existsSync(path.join(workspace, sidecarPath))) {
        preserve.push(makeItem(sidecarPath, 'existing Knight sidecar file'));
      } else {
        sidecar.push(makeItem(sidecarPath, `sidecar for existing ${relPath}`, {
          type: 'template',
          source: relPath,
          conflict: relPath,
        }));
      }
    } else {
      preserve.push(makeItem(relPath, 'existing user-owned file'));
    }
  }

  for (const relPath of listFiles(scriptsDir)) {
    const scriptPath = path.join('scripts', relPath);
    if (fs.existsSync(path.join(workspace, scriptPath))) {
      preserve.push(makeItem(scriptPath, 'existing script preserved'));
    } else {
      add.push(makeItem(scriptPath, 'missing Knight script', {
        type: 'script',
        source: relPath,
      }));
    }
  }

  if (fs.existsSync(path.join(workspace, 'knight.config.json'))) {
    manual.push(makeItem('knight.config.json', 'existing config preserved; review missing Knight fields manually'));
  } else {
    add.push(makeItem('knight.config.json', 'missing Knight config', { type: 'config' }));
  }

  add.push(makeItem('.knight/manifest.json', 'record adopted Knight files', {
    type: 'manifest',
    sourceTemplateVersion: packageVersion,
  }));
  add.push(makeItem('.knight/adoption-report.md', 'record adoption result', {
    type: 'report',
    sourceTemplateVersion: packageVersion,
  }));

  return {
    workspace,
    existingMemory: hasExistingMemory(workspace),
    sourceTemplateVersion: packageVersion,
    preserve,
    add,
    sidecar,
    manual,
  };
}

function writeTemplate(workspace, templatesDir, relPath, destRelPath, vars) {
  const content = fs.readFileSync(path.join(templatesDir, relPath), 'utf8');
  const dest = path.join(workspace, destRelPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, renderTemplate(content, vars), 'utf8');
}

function writeScript(workspace, scriptsDir, sourceRelPath, destRelPath) {
  const dest = path.join(workspace, destRelPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(scriptsDir, sourceRelPath), dest);
}

function buildManifest(plan, applied, opts) {
  const now = opts.now || new Date().toISOString();
  const files = [];

  for (const item of plan.preserve) {
    files.push({
      path: item.path,
      action: 'preserve',
      userOwned: true,
      managedByKnight: false,
    });
  }

  for (const item of applied.add.concat(applied.sidecar)) {
    files.push({
      path: item.path,
      action: item.action,
      createdAt: now,
      sourceTemplateVersion: plan.sourceTemplateVersion,
      userOwned: false,
      managedByKnight: true,
      source: item.source || null,
      conflict: item.conflict || null,
    });
  }

  for (const item of plan.manual) {
    files.push({
      path: item.path,
      action: 'manual',
      userOwned: true,
      managedByKnight: false,
      reason: item.reason,
    });
  }

  return {
    version: 1,
    adoptedAt: now,
    sourceTemplateVersion: plan.sourceTemplateVersion,
    files,
  };
}

function buildReport(plan, applied, backupPath) {
  const lines = [
    '# Knight OS Adoption Report',
    '',
    `Workspace: ${plan.workspace}`,
    `Adopted at: ${new Date().toISOString()}`,
    `Backup: ${backupPath}`,
    '',
    '## Preserved',
  ];

  const append = (items, empty) => {
    if (items.length === 0) {
      lines.push(`- ${empty}`);
    } else {
      items.forEach((item) => lines.push(`- ${item.path} - ${item.reason || item.action}`));
    }
  };

  append(plan.preserve, 'none');
  lines.push('', '## Added');
  append(applied.add, 'none');
  lines.push('', '## Sidecars');
  append(applied.sidecar, 'none');
  lines.push('', '## Manual Review');
  append(plan.manual, 'none');
  lines.push('');
  return lines.join('\n');
}

function applyAdoptionPlan(plan, opts) {
  opts = opts || {};
  const workspace = plan.workspace;
  const templatesDir = opts.templatesDir;
  const scriptsDir = opts.scriptsDir;
  const vars = opts.vars || {};
  fs.mkdirSync(workspace, { recursive: true });
  const backupPath = backupWorkspace(workspace);
  const applied = { add: [], sidecar: [] };

  for (const item of plan.add) {
    const dest = path.join(workspace, item.path);
    if (item.type === 'directory') {
      fs.mkdirSync(dest, { recursive: true });
    } else if (item.type === 'template') {
      if (fs.existsSync(dest)) continue;
      writeTemplate(workspace, templatesDir, item.source, item.path, vars);
    } else if (item.type === 'script') {
      if (fs.existsSync(dest)) continue;
      writeScript(workspace, scriptsDir, item.source, item.path);
    } else if (item.type === 'config') {
      if (fs.existsSync(dest)) continue;
      fs.writeFileSync(dest, JSON.stringify(defaultConfig(workspace, vars), null, 2) + '\n', 'utf8');
    }

    if (!['manifest', 'report'].includes(item.type)) {
      applied.add.push(Object.assign({}, item, { action: 'add' }));
    }
  }

  for (const item of plan.sidecar) {
    const dest = path.join(workspace, item.path);
    if (fs.existsSync(dest)) continue;
    writeTemplate(workspace, templatesDir, item.source, item.path, vars);
    applied.sidecar.push(Object.assign({}, item, { action: 'sidecar' }));
  }

  const knightDir = path.join(workspace, '.knight');
  fs.mkdirSync(knightDir, { recursive: true });
  const manifest = buildManifest(plan, applied, opts);
  const manifestPath = path.join(knightDir, 'manifest.json');
  let manifestToWrite = manifest;
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifestToWrite = deepMergeMissing(manifest, existing);
      manifestToWrite.updatedAt = new Date().toISOString();
      manifestToWrite.files = manifest.files;
    } catch {}
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifestToWrite, null, 2) + '\n', 'utf8');
  applied.add.push({ path: '.knight/manifest.json', action: 'add', reason: 'record adopted Knight files' });

  const reportPath = path.join(knightDir, 'adoption-report.md');
  if (!fs.existsSync(reportPath)) {
    fs.writeFileSync(reportPath, buildReport(plan, applied, backupPath), 'utf8');
    applied.add.push({ path: '.knight/adoption-report.md', action: 'add', reason: 'record adoption result' });
  }

  return { backupPath, applied, manifestPath, reportPath };
}

function printAdoptionPlan(plan) {
  console.log('\nKnight OS Adoption Plan');
  console.log(`Workspace: ${plan.workspace}`);
  console.log(`Existing memory detected: ${plan.existingMemory ? 'yes' : 'no'}\n`);

  const print = (title, items, empty) => {
    console.log(`${title}:`);
    if (items.length === 0) {
      console.log(`  - ${empty}`);
    } else {
      items.forEach((item) => console.log(`  - ${item.path} (${item.reason})`));
    }
    console.log('');
  };

  print('preserve', plan.preserve, 'none');
  print('add', plan.add, 'none');
  print('sidecar', plan.sidecar, 'none');
  print('manual', plan.manual, 'none');
  console.log('No files were changed. To apply this plan, run `knight adopt`.\n');
}

module.exports = {
  SIDECAR_PATHS,
  applyAdoptionPlan,
  createAdoptionPlan,
  printAdoptionPlan,
};
