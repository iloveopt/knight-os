#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadConfig, resolveWorkspace } = require('../src/config');
const { chat } = require('../src/chat');
const { setup } = require('../src/setup');
const { dashboard } = require('../src/dashboard');
const {
  runMigrations,
  checkVersion,
  refreshTemplates,
  backupWorkspace,
  CURRENT_DATA_VERSION,
} = require('../src/migrate');

const VERSION = '0.1.0';
const DEFAULT_WORKSPACE = path.join(process.env.HOME || '~', '.openclaw', 'workspace');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function getAllTemplateFiles(dir, base) {
  base = base || dir;
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllTemplateFiles(fullPath, base));
    } else {
      results.push(path.relative(base, fullPath));
    }
  }
  return results;
}

function replacePlaceholders(content, vars) {
  return content
    .replace(/\{\{AI_NAME\}\}/g, vars.aiName)
    .replace(/\{\{USER_NAME\}\}/g, vars.userName)
    .replace(/\{\{TIMEZONE\}\}/g, vars.timezone)
    .replace(/\{\{LANGUAGE\}\}/g, vars.language || 'en')
    .replace(/\{\{CHANNEL\}\}/g, vars.channel || 'direct');
}

async function commandInit() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n🐉 Knight OS — OpenClaw Workspace Initializer\n');

  const aiName = await ask(rl, "Your AI companion's name? (e.g. Aria, Nova, Kai): ");
  if (!aiName) {
    console.log('AI name is required.');
    rl.close();
    process.exit(1);
  }

  const userName = await ask(rl, 'Your name? (used to personalize the workspace): ');
  if (!userName) {
    console.log('Your name is required.');
    rl.close();
    process.exit(1);
  }

  const timezone = await ask(rl, 'Your timezone? (e.g. Asia/Tokyo, America/New_York): ');
  if (!timezone) {
    console.log('Timezone is required.');
    rl.close();
    process.exit(1);
  }

  const workspaceInput = await ask(rl, `Workspace directory? [${DEFAULT_WORKSPACE}]: `);
  const workspace = workspaceInput || DEFAULT_WORKSPACE;

  const apiKeyInput = await ask(
    rl,
    'Anthropic API key? (starts with sk-ant-, leave blank to skip): '
  );

  const modelInput = await ask(rl, 'Default model? [claude-sonnet-4-5]: ');
  const modelName = modelInput || 'claude-sonnet-4-5';

  console.log('\n--- Preview ---');
  console.log(`  AI Name:    ${aiName}`);
  console.log(`  User Name:  ${userName}`);
  console.log(`  Timezone:   ${timezone}`);
  console.log(`  Workspace:  ${workspace}`);
  console.log(`  Model:      ${modelName}`);
  if (apiKeyInput) console.log(`  API Key:    ${apiKeyInput.slice(0, 12)}...`);
  console.log('---------------\n');

  const confirm = await ask(rl, 'Press Enter to confirm, or type "no" to cancel: ');
  if (confirm.toLowerCase() === 'no') {
    console.log('Cancelled.');
    rl.close();
    process.exit(0);
  }

  rl.close();

  const vars = { aiName, userName, timezone };
  const templateFiles = getAllTemplateFiles(TEMPLATES_DIR);

  fs.mkdirSync(workspace, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const relPath of templateFiles) {
    const srcPath = path.join(TEMPLATES_DIR, relPath);
    const destPath = path.join(workspace, relPath);
    const destDir = path.dirname(destPath);

    fs.mkdirSync(destDir, { recursive: true });

    if (fs.existsSync(destPath)) {
      const rlConfirm = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const overwrite = await ask(rlConfirm, `  File exists: ${relPath} — overwrite? [y/N]: `);
      rlConfirm.close();
      if (overwrite.toLowerCase() !== 'y') {
        skipped++;
        continue;
      }
    }

    const content = fs.readFileSync(srcPath, 'utf-8');
    const processed = replacePlaceholders(content, vars);
    fs.writeFileSync(destPath, processed, 'utf-8');
    written++;
  }

  if (apiKeyInput) {
    const envPath = path.join(workspace, '.env');
    const envLine = `ANTHROPIC_API_KEY=${apiKeyInput}\n`;
    if (fs.existsSync(envPath)) {
      fs.appendFileSync(envPath, envLine, 'utf-8');
    } else {
      fs.writeFileSync(envPath, envLine, 'utf-8');
    }
  }

  const configPath = path.join(workspace, 'knight.config.json');
  let existingConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {}
  }
  existingConfig.model = {
    provider: 'anthropic',
    name: modelName,
    max_tokens: 8096,
    system_prompt_files: ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'REDLINES.md'],
  };
  fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2) + '\n', 'utf-8');

  console.log(`\n✅ Workspace initialized at ${workspace}`);
  console.log(`   ${written} file(s) written, ${skipped} skipped.\n`);
  console.log('Next steps:');
  console.log(`  1. Review your workspace files in ${workspace}`);
  console.log('  2. Customize SOUL.md and USER.md to match your preferences');
  console.log('  3. Run \`knight chat\` to start talking to your AI companion');
  console.log('');
}

function commandStatus() {
  const workspace = DEFAULT_WORKSPACE;
  const requiredFiles = [
    'AGENTS.md',
    'SOUL.md',
    'MEMORY.md',
    'HEARTBEAT.md',
    'REDLINES.md',
    'USER.md',
    'TOOLS.md',
    'memory/ai-patterns.md',
    'memory/user-patterns.md',
  ];

  console.log(`\n📋 Knight OS — Workspace Status`);
  console.log(`   Directory: ${workspace}\n`);

  if (!fs.existsSync(workspace)) {
    console.log('   ❌ Workspace directory does not exist.');
    console.log('   Run "knight init" to create it.\n');
    process.exit(1);
  }

  let ok = 0;
  let missing = 0;

  for (const file of requiredFiles) {
    const fullPath = path.join(workspace, file);
    if (fs.existsSync(fullPath)) {
      console.log(`   ✅ ${file}`);
      ok++;
    } else {
      console.log(`   ❌ ${file}`);
      missing++;
    }
  }

  console.log(`\n   Result: ${ok} present, ${missing} missing.\n`);
}

function commandVersion() {
  console.log(`knight-os v${VERSION}`);
}

async function commandUpgrade() {
  const workspace = DEFAULT_WORKSPACE;

  console.log(`\n🔄 Knight OS — Upgrade Check`);
  console.log(`   Workspace: ${workspace}\n`);

  if (!fs.existsSync(workspace)) {
    console.log('   ❌ Workspace not found. Run "knight setup" first.\n');
    process.exit(1);
  }

  // 1. Run data migrations
  const { migrated, backupPath, error } = runMigrations(workspace);
  if (error) {
    console.error(`\n❌ Upgrade failed: ${error.message}\n`);
    process.exit(1);
  }

  if (!migrated) {
    const { currentVersion } = checkVersion(workspace);
    console.log(`   ✅ Already up to date (data v${currentVersion}).\n`);
  }

  // 2. Refresh non-protected template files (add new ones, skip existing)
  console.log('   Checking for new template files…');
  const { added, skipped } = refreshTemplates(workspace, TEMPLATES_DIR);
  if (added.length > 0) {
    console.log(`   ✅ Added ${added.length} new file(s):`);
    added.forEach((f) => console.log(`      + ${f}`));
  } else {
    console.log('   ✅ No new template files.');
  }

  const protectedSkipped = skipped.filter((s) => s.includes('(protected)'));
  if (protectedSkipped.length > 0) {
    console.log(`\n   🔒 Protected files untouched (your personal data is safe):`);
    protectedSkipped.forEach((f) => console.log(`      ${f}`));
  }

  if (backupPath) {
    console.log(`\n   📦 Backup kept at:\n      ${backupPath}`);
  }

  console.log(`\n✅ Upgrade complete. Workspace is at data v${CURRENT_DATA_VERSION}.\n`);
}

async function commandChat() {
  const config = loadConfig();
  const workspace = resolveWorkspace(config);
  await chat(config, workspace);
}

function commandDashboard() {
  const config = loadConfig();
  const workspace = resolveWorkspace(config);
  const args = process.argv.slice(3);
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
  const noOpen = args.includes('--no-open');
  dashboard(config, workspace, { output: outputPath, open: !noOpen });
}

const command = process.argv[2];

switch (command) {
  case 'setup':
    setup();
    break;
  case 'init':
    commandInit();
    break;
  case 'chat':
    commandChat();
    break;
  case 'status':
    commandStatus();
    break;
  case 'upgrade':
    commandUpgrade();
    break;
  case 'dashboard':
    commandDashboard();
    break;
  case 'version':
  case '--version':
  case '-v':
    commandVersion();
    break;
  default:
    console.log(`knight-os v${VERSION}`);
    console.log('\nUsage: knight <command>\n');
    console.log('Commands:');
    console.log('  setup     Configure Knight OS for an existing OpenClaw installation');
    console.log('  init      Initialize a new workspace (standalone, no OpenClaw required)');
    console.log('  chat      Start interactive AI chat session');
    console.log('  status    Check workspace file status');
    console.log('  upgrade   Migrate workspace data + refresh template files safely');
  console.log('  dashboard Generate a local HTML dashboard from your workspace data');
    console.log('  version   Show version number');
    console.log('');
    break;
}
