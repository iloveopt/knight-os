'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');
const {
  backupWorkspace,
  deepMergeMissing,
  hasExistingMemory,
  renderTemplate,
  writeDataVersion,
  CURRENT_DATA_VERSION,
} = require('./migrate');

const DEFAULT_WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function checkOpenClawCli() {
  // OpenClaw is expected to already exist, but its CLI may not be exposed in PATH.
  try {
    const result = spawnSync('openclaw', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && !result.error) {
      return { found: true, version: (result.stdout || '').trim().split('\n')[0] || 'unknown' };
    }
  } catch (_) {}

  return { found: false };
}

function findPython3() {
  // Prefer the python3 that's actually in PATH (accounts for Homebrew, pyenv, etc.)
  try {
    const result = spawnSync('which', ['python3'], { encoding: 'utf8', timeout: 3000 });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch (_) {}
  // Fallback candidates
  for (const p of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']) {
    if (fs.existsSync(p)) return p;
  }
  return 'python3'; // last resort: let the shell resolve it
}

function writeEnv(workspace, vars) {
  const envPath = path.join(workspace, '.env');
  let existing = '';
  if (fs.existsSync(envPath)) {
    existing = fs.readFileSync(envPath, 'utf-8');
  }
  const envMap = {};
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    envMap[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  Object.assign(envMap, vars);
  const lines = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

function registerHeartbeat(workspace, intervalHours) {
  const platform = os.platform();
  const python3 = findPython3();

  if (platform === 'darwin') {
    const label = 'ai.knight.heartbeat';
    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(launchAgentsDir, `${label}.plist`);
    const scriptPath = path.join(workspace, 'scripts', 'heartbeat.py');
    const logPath = path.join(workspace, 'memory', 'logs', 'heartbeat.log');

    // Ensure dirs exist
    try { fs.mkdirSync(launchAgentsDir, { recursive: true }); } catch (_) {}
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch (_) {}

    const intervalSecs = Math.max(1, Math.floor(intervalHours * 3600));
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${python3}</string>
    <string>${scriptPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workspace}</string>
  <key>StartInterval</key>
  <integer>${intervalSecs}</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;

    // Unload if already registered
    try { spawnSync('launchctl', ['unload', plistPath], { stdio: 'ignore' }); } catch (_) {}

    try {
      fs.writeFileSync(plistPath, plist, 'utf-8');
    } catch (e) {
      return { ok: false, method: 'launchd', error: `Failed to write plist: ${e.message}` };
    }

    try {
      const result = spawnSync('launchctl', ['load', plistPath], { encoding: 'utf8' });
      if (result.status !== 0) {
        return { ok: false, method: 'launchd', error: result.stderr || 'launchctl load failed' };
      }
      return { ok: true, method: 'launchd', path: plistPath };
    } catch (e) {
      return { ok: false, method: 'launchd', error: e.message };
    }

  } else if (platform === 'linux') {
    const scriptPath = path.join(workspace, 'scripts', 'heartbeat.py');
    const logPath = path.join(workspace, 'memory', 'logs', 'heartbeat.log');
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch (_) {}

    // Use safe quoting for cron entry — no shell interpolation
    const safeScript = scriptPath.replace(/'/g, "'\\''");
    const safeLog = logPath.replace(/'/g, "'\\''");
    const cronLine = `0 */${Math.max(1, Math.floor(intervalHours))} * * * '${python3}' '${safeScript}' >> '${safeLog}' 2>&1`;

    try {
      let existing = '';
      try {
        const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
        if (r.status === 0) existing = r.stdout;
      } catch (_) {}

      if (!existing.includes(scriptPath)) {
        const newCron = existing.trimEnd() + '\n' + cronLine + '\n';
        const result = spawnSync('crontab', ['-'], {
          input: newCron,
          encoding: 'utf8',
        });
        if (result.status !== 0) {
          return { ok: false, method: 'cron', error: result.stderr || 'crontab write failed' };
        }
      }
      return { ok: true, method: 'cron', line: cronLine };
    } catch (e) {
      return { ok: false, method: 'cron', error: e.message };
    }

  } else {
    return {
      ok: false,
      method: 'none',
      error: 'Automatic heartbeat not supported on this platform. Run heartbeat.py manually or use Task Scheduler.',
    };
  }
}

function writeSetupTemplates(workspace, vars, opts) {
  opts = opts || {};
  const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
  const safeExistingPath = Boolean(opts.safeExistingPath);
  const overwriteTemplates = Boolean(opts.overwriteTemplates);
  const written = [];
  const skipped = [];
  const warnings = [];

  function copyTemplates(srcDir, destDir) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name);
      const dest = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        copyTemplates(src, dest);
      } else {
        const relPath = path.relative(workspace, dest);
        if (fs.existsSync(dest) && (safeExistingPath || !overwriteTemplates)) {
          skipped.push(relPath);
          continue;
        }
        try {
          const content = fs.readFileSync(src, 'utf-8');
          fs.writeFileSync(dest, renderTemplate(content, vars), 'utf-8');
          written.push(relPath);
        } catch (e) {
          warnings.push({ path: relPath, message: e.message });
        }
      }
    }
  }

  copyTemplates(TEMPLATES_DIR, workspace);
  return { written, skipped, warnings };
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const separator = '──────────────────────────────────────────────────────';

  const closeAndExit = (code) => {
    rl.close();
    process.exit(code);
  };

  console.log('\n🐉 Knight OS — Setup Wizard\n');
  console.log('This wizard configures your OpenClaw workspace with the Knight OS');
  console.log('memory, reflection, and identity framework.\n');
  console.log(separator);

  // Step 1: Workspace directory
  console.log('\n[1/6] Workspace configuration');
  const workspaceInput = await ask(rl, 'Workspace directory', DEFAULT_WORKSPACE);
  const workspace = path.resolve(workspaceInput.replace(/^~/, os.homedir()));

  const workspaceExists = fs.existsSync(workspace);
  const hasCoreFiles = workspaceExists && fs.existsSync(path.join(workspace, 'AGENTS.md'));
  const existingMemory = hasExistingMemory(workspace);

  if (workspaceExists) {
    console.log(`  ✅ Workspace path exists: ${workspace}`);
  } else {
    console.log(`  ℹ️  Workspace path will be created: ${workspace}`);
  }

  // Step 2: Optional OpenClaw CLI info
  process.stdout.write('\n[2/6] OpenClaw CLI availability (optional)... ');
  const oc = checkOpenClawCli();
  if (oc.found) {
    console.log(`found (${oc.version})`);
  } else {
    console.log('not found in PATH; continuing with workspace setup');
  }

  const safeExistingPath = workspaceExists && existingMemory;
  let writeTemplates = true;
  let overwriteTemplates = !safeExistingPath && !workspaceExists;

  if (safeExistingPath) {
    console.log(`\n⚠️  Existing memory/OpenClaw workspace detected at: ${workspace}`);
    console.log('   Knight OS will preserve existing files and only add missing capability files.');
    console.log('   Existing AGENTS.md, PROJECTS.md, TOOLS.md, HEARTBEAT.md, MEMORY.md, and memory/*.md files will be skipped.\n');
  } else if (hasCoreFiles) {
    console.log(`\n⚠️  Workspace already exists at: ${workspace}`);
    const answer = await ask(rl, 'Overwrite existing files? (y/N)', 'N');
    overwriteTemplates = answer.toLowerCase().startsWith('y');
    writeTemplates = overwriteTemplates;
    if (!writeTemplates) {
      console.log('\nSkipping template write. Continuing with other setup steps...');
    }
  }

  let setupBackupPath = null;
  if (safeExistingPath) {
    try {
      setupBackupPath = backupWorkspace(workspace);
    } catch (e) {
      console.log(`\n❌ Failed to create setup backup: ${e.message}`);
      closeAndExit(1);
      return;
    }
  }

  // Create required dirs
  try {
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(path.join(workspace, 'memory', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'memory', 'projects'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'memory', 'reflections'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true });
  } catch (e) {
    console.log(`\n❌ Failed to create workspace directory: ${e.message}`);
    closeAndExit(1);
    return;
  }

  // Step 3: Identity questions
  console.log('\n[3/6] Identity setup');
  const aiName = await ask(rl, "Your AI companion's name (e.g. Aria, Nova, Kai)", 'Knight');
  const userName = await ask(rl, 'Your name', '');
  if (!userName) {
    console.log('Name is required.');
    closeAndExit(1);
    return;
  }
  const timezone = await ask(rl, 'Your timezone (e.g. Asia/Tokyo, America/New_York)', 'UTC');
  const language = await ask(rl, 'Primary language (en / zh / ja)', 'en');

  // Step 4: API key
  console.log('\n[4/6] API configuration');
  let anthropicKey = '';
  while (true) {
    const input = await ask(rl, 'Anthropic API key (starts with sk-ant-, leave blank to skip)', '');
    if (!input) break;
    if (input.startsWith('sk-ant-')) {
      anthropicKey = input;
      break;
    }
    console.log("  ⚠️  API key should start with 'sk-ant-'. Try again or leave blank to skip.");
  }

  // Step 5: Notifications (optional)
  console.log('\n[5/6] Notifications (optional — press Enter to skip)');
  const tgToken = await ask(rl, 'Telegram Bot Token', '');
  const tgChatId = tgToken ? await ask(rl, 'Telegram Chat ID', '') : '';

  // Step 6: Heartbeat
  console.log('\n[6/6] Heartbeat scheduler');
  const enableHb = await ask(rl, 'Register automatic heartbeat? (Y/n)', 'Y');
  const doHeartbeat = !enableHb.toLowerCase().startsWith('n');
  let hbIntervalHours = 6;
  if (doHeartbeat) {
    const hbInterval = await ask(rl, 'Heartbeat interval in hours (min 1, max 24)', '6');
    const parsed = parseInt(hbInterval, 10);
    hbIntervalHours = (isNaN(parsed) || parsed < 1) ? 6 : Math.min(parsed, 24);
  }

  rl.close();

  console.log(`\n${separator}`);
  console.log('⚙️  Writing workspace files...\n');

  // Write templates
  if (writeTemplates) {
    const vars = { aiName, userName, timezone, language };
    const result = writeSetupTemplates(workspace, vars, { safeExistingPath, overwriteTemplates });
    result.written.forEach((relPath) => console.log(`  ✅ ${relPath}`));
    result.skipped.forEach((relPath) => console.log(`  🔒 ${relPath} (existing, skipped)`));
    result.warnings.forEach((warning) => console.log(`  ⚠️  ${warning.path}: ${warning.message}`));
  } else {
    console.log('  ⏭️  Templates skipped (existing files preserved)');
  }

  // Copy scripts (never overwrite — user may have customized them)
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const destScriptsDir = path.join(workspace, 'scripts');
  fs.mkdirSync(destScriptsDir, { recursive: true });
  for (const file of fs.readdirSync(scriptsDir)) {
    const src = path.join(scriptsDir, file);
    const dest = path.join(destScriptsDir, file);
    if (!fs.existsSync(dest)) {
      try {
        fs.copyFileSync(src, dest);
        console.log(`  ✅ scripts/${file}`);
      } catch (e) {
        console.log(`  ⚠️  scripts/${file}: ${e.message}`);
      }
    }
  }

  // Write knight.config.json
  const defaultConfig = {
    workspace,
    ai_name: aiName,
    user_name: userName,
    timezone,
    storage: {
      backend: 'local',
      local: { reflections_dir: 'memory/reflections', logs_dir: 'memory/logs', memory_file: 'MEMORY.md' },
      supabase: { url: '', service_key: '', enabled: false },
    },
    notifications: {
      backend: tgToken ? 'telegram' : 'none',
      telegram: { bot_token: tgToken, chat_id: tgChatId, enabled: !!tgToken },
    },
    heartbeat: {
      interval_hours: hbIntervalHours,
      enabled: doHeartbeat,
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

  try {
    const configDest = path.join(workspace, 'knight.config.json');
    let existingConfig = {};
    if (fs.existsSync(configDest)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(configDest, 'utf-8'));
      } catch {}
    }
    const config = fs.existsSync(configDest)
      ? deepMergeMissing(defaultConfig, existingConfig)
      : defaultConfig;
    fs.writeFileSync(configDest, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log('  ✅ knight.config.json');
  } catch (e) {
    console.log(`  ⚠️  knight.config.json: ${e.message}`);
  }

  // Write .env
  const envVars = {};
  if (anthropicKey) envVars.ANTHROPIC_API_KEY = anthropicKey;
  if (tgToken) envVars.TELEGRAM_BOT_TOKEN = tgToken;
  if (tgChatId) envVars.TELEGRAM_CHAT_ID = tgChatId;
  if (Object.keys(envVars).length > 0) {
    try {
      writeEnv(workspace, envVars);
      console.log('  ✅ .env');
    } catch (e) {
      console.log(`  ⚠️  .env: ${e.message}`);
    }
  }

  // Register heartbeat
  if (doHeartbeat) {
    process.stdout.write('\n⏱️  Registering heartbeat scheduler... ');
    const result = registerHeartbeat(workspace, hbIntervalHours);
    if (result.ok) {
      console.log(`✅ ${result.method} (every ${hbIntervalHours}h)`);
    } else {
      console.log(`⚠️  ${result.error}`);
      console.log(`   Manual: run \`python3 ${path.join(workspace, 'scripts', 'heartbeat.py')}\` periodically`);
    }
  }

  // Record the data version so future upgrades know where to start
  writeDataVersion(workspace, CURRENT_DATA_VERSION);
  if (setupBackupPath) {
    console.log(`\n📦 Setup backup kept at:\n   ${setupBackupPath}`);
  }

  console.log(`\n${separator}`);
  console.log('✅ Knight OS setup complete!\n');
  console.log(`Workspace: ${workspace}`);
  console.log('\nNext steps:');
  console.log('  1. Review and customize your SOUL.md (AI personality)');
  console.log('  2. Fill in USER.md (your profile)');
  if (oc.found) {
    console.log('  3. Start chatting: openclaw chat\n');
  } else {
    console.log('  3. Start chatting from your OpenClaw environment\n');
  }
  console.log('How memory works:');
  console.log('  Task done → write-reflection.py → memory/reflections/');
  console.log('  Heartbeat  → reflection-analyzer.py → candidate rules extracted');
  console.log('  You confirm → rules added to memory/ai-patterns.md');
  console.log('  Next session → ai-patterns.md in system prompt → AI learns\n');
  console.log(`${separator}\n`);
}

module.exports = { setup, writeSetupTemplates };
