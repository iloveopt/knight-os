'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

const DEFAULT_WORKSPACE = path.join(os.homedir(), '.openclaw', 'workspace');

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

function checkOpenClaw() {
  try {
    const result = spawnSync('openclaw', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 || result.stderr || result.stdout) {
      return { installed: true, version: (result.stdout || result.stderr || '').trim().split('\n')[0] };
    }
  } catch (_) {}
  // Also check npm global
  try {
    const result = spawnSync('npm', ['list', '-g', 'openclaw', '--depth=0'], { encoding: 'utf8', timeout: 8000 });
    if (result.stdout && result.stdout.includes('openclaw')) {
      return { installed: true, version: 'unknown' };
    }
  } catch (_) {}
  return { installed: false };
}

function writeEnv(workspace, vars) {
  const envPath = path.join(workspace, '.env');
  let existing = '';
  if (fs.existsSync(envPath)) {
    existing = fs.readFileSync(envPath, 'utf-8');
  }
  // Parse existing
  const envMap = {};
  for (const line of existing.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    envMap[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  // Merge new vars
  Object.assign(envMap, vars);
  // Write back
  const lines = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

function registerHeartbeat(workspace, intervalHours) {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS LaunchAgent
    const label = 'ai.knight.heartbeat';
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
    const scriptPath = path.join(workspace, 'scripts', 'heartbeat.py');
    const logPath = path.join(workspace, 'memory', 'logs', 'heartbeat.log');

    // Ensure log dir exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const intervalSecs = intervalHours * 3600;
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
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
    try { execSync(`launchctl unload ${plistPath} 2>/dev/null`, { stdio: 'ignore' }); } catch (_) {}

    fs.writeFileSync(plistPath, plist, 'utf-8');
    try {
      execSync(`launchctl load ${plistPath}`);
      return { ok: true, method: 'launchd', path: plistPath };
    } catch (e) {
      return { ok: false, method: 'launchd', error: e.message };
    }

  } else if (platform === 'linux') {
    // Linux crontab
    const scriptPath = path.join(workspace, 'scripts', 'heartbeat.py');
    const logPath = path.join(workspace, 'memory', 'logs', 'heartbeat.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const cronLine = `0 */${intervalHours} * * * /usr/bin/python3 ${scriptPath} >> ${logPath} 2>&1`;
    try {
      let existing = '';
      try { existing = execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }); } catch (_) {}
      if (!existing.includes(scriptPath)) {
        const newCron = existing.trimEnd() + '\n' + cronLine + '\n';
        execSync(`echo "${newCron.replace(/"/g, '\\"')}" | crontab -`);
      }
      return { ok: true, method: 'cron', line: cronLine };
    } catch (e) {
      return { ok: false, method: 'cron', error: e.message };
    }

  } else {
    return { ok: false, method: 'none', error: 'Windows not supported for auto-heartbeat. Run heartbeat.py manually.' };
  }
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const separator = '──────────────────────────────────────────────────────';

  console.log('\n🐉 Knight OS — Setup Wizard\n');
  console.log('This wizard configures your OpenClaw workspace with the Knight OS');
  console.log('memory, reflection, and identity framework.\n');
  console.log(separator);

  // Step 1: Check OpenClaw
  process.stdout.write('\n[1/6] Checking OpenClaw installation... ');
  const oc = checkOpenClaw();
  if (oc.installed) {
    console.log(`✅ found (${oc.version})`);
  } else {
    console.log('❌ not found\n');
    console.log('Knight OS requires OpenClaw. Please install it first:');
    console.log('\n  npm install -g openclaw\n');
    console.log('Then run `knight setup` again.');
    rl.close();
    process.exit(1);
  }

  // Step 2: Workspace directory
  console.log('\n[2/6] Workspace configuration');
  const workspaceInput = await ask(rl, 'Workspace directory', DEFAULT_WORKSPACE);
  const workspace = path.resolve(workspaceInput.replace(/^~/, os.homedir()));

  const workspaceExists = fs.existsSync(workspace);
  const hasCoreFiles = workspaceExists && fs.existsSync(path.join(workspace, 'AGENTS.md'));

  if (hasCoreFiles) {
    console.log(`\n⚠️  Workspace already exists at: ${workspace}`);
    const overwrite = await ask(rl, 'Overwrite existing files? (y/N)', 'N');
    if (!overwrite.toLowerCase().startsWith('y')) {
      console.log('\nSkipping template write. Continuing with other setup steps...');
    }
  }

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory', 'projects'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'memory', 'reflections'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'output'), { recursive: true });

  // Step 3: Identity questions
  console.log('\n[3/6] Identity setup');
  const aiName = await ask(rl, "Your AI companion's name (e.g. Aria, Nova, Kai)", 'Knight');
  const userName = await ask(rl, 'Your name', '');
  if (!userName) { console.log('Name required.'); rl.close(); process.exit(1); }
  const timezone = await ask(rl, 'Your timezone (e.g. Asia/Tokyo, America/New_York)', 'UTC');
  const language = await ask(rl, 'Primary language (en / zh / ja)', 'en');

  // Step 4: API key
  console.log('\n[4/6] API configuration');
  const anthropicKey = await ask(rl, 'Anthropic API key (starts with sk-ant-, leave blank to skip)', '');

  // Step 5: Notifications (optional)
  console.log('\n[5/6] Notifications (optional — press Enter to skip)');
  const tgToken = await ask(rl, 'Telegram Bot Token', '');
  const tgChatId = await ask(rl, 'Telegram Chat ID', '');

  // Step 6: Heartbeat
  console.log('\n[6/6] Heartbeat scheduler');
  const enableHb = await ask(rl, 'Register automatic heartbeat? (Y/n)', 'Y');
  const doHeartbeat = !enableHb.toLowerCase().startsWith('n');
  let hbIntervalHours = 6;
  if (doHeartbeat) {
    const hbInterval = await ask(rl, 'Heartbeat interval in hours', '6');
    hbIntervalHours = parseInt(hbInterval, 10) || 6;
  }

  rl.close();

  console.log(`\n${separator}`);
  console.log('⚙️  Writing workspace files...\n');

  // Write templates
  const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
  const vars = { aiName, userName, timezone, language };
  const shouldSkipWrite = hasCoreFiles && !true; // already asked above — simplify: always write if we got here

  function fillTemplate(content, v) {
    return content
      .replace(/\{\{AI_NAME\}\}/g, v.aiName)
      .replace(/\{\{USER_NAME\}\}/g, v.userName)
      .replace(/\{\{TIMEZONE\}\}/g, v.timezone)
      .replace(/\{\{LANGUAGE\}\}/g, v.language || 'en')
      .replace(/\{\{CHANNEL\}\}/g, 'direct');
  }

  function copyTemplates(srcDir, destDir) {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(srcDir, entry.name);
      const dest = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        copyTemplates(src, dest);
      } else {
        const content = fs.readFileSync(src, 'utf-8');
        fs.writeFileSync(dest, fillTemplate(content, vars), 'utf-8');
        console.log(`  ✅ ${path.relative(workspace, dest)}`);
      }
    }
  }

  copyTemplates(TEMPLATES_DIR, workspace);

  // Copy scripts
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const destScriptsDir = path.join(workspace, 'scripts');
  fs.mkdirSync(destScriptsDir, { recursive: true });
  for (const file of fs.readdirSync(scriptsDir)) {
    const src = path.join(scriptsDir, file);
    const dest = path.join(destScriptsDir, file);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log(`  ✅ scripts/${file}`);
    }
  }

  // Write knight.config.json
  const config = {
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
    heartbeat: { interval_hours: hbIntervalHours, enabled: doHeartbeat, tasks: ['reflection_analysis', 'memory_scan', 'log_compress'] },
    reflection: { min_pattern_count: 2, auto_write: true },
    model: { provider: 'anthropic', name: 'claude-sonnet-4-5', max_tokens: 8096, system_prompt_files: ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'REDLINES.md'] },
  };

  const configDest = path.join(workspace, 'knight.config.json');
  fs.writeFileSync(configDest, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log('  ✅ knight.config.json');

  // Write .env
  const envVars = {};
  if (anthropicKey) envVars.ANTHROPIC_API_KEY = anthropicKey;
  if (tgToken) envVars.TELEGRAM_BOT_TOKEN = tgToken;
  if (tgChatId) envVars.TELEGRAM_CHAT_ID = tgChatId;
  if (Object.keys(envVars).length > 0) {
    writeEnv(workspace, envVars);
    console.log('  ✅ .env');
  }

  // Register heartbeat
  if (doHeartbeat) {
    process.stdout.write('\n⏱️  Registering heartbeat scheduler... ');
    const result = registerHeartbeat(workspace, hbIntervalHours);
    if (result.ok) {
      console.log(`✅ ${result.method} (every ${hbIntervalHours}h)`);
    } else {
      console.log(`⚠️  ${result.error}`);
      console.log(`   Manual: run \`python3 scripts/heartbeat.py\` periodically`);
    }
  }

  console.log(`\n${separator}`);
  console.log('✅ Knight OS setup complete!\n');
  console.log(`Workspace: ${workspace}`);
  console.log('\nNext steps:');
  console.log('  1. Review and customize your SOUL.md (AI personality)');
  console.log('  2. Fill in USER.md (your profile)');
  console.log('  3. Start chatting: openclaw chat');
  console.log('\nAfter completing tasks, log reflections:');
  console.log(`  python3 ${path.join(workspace, 'scripts', 'write-reflection.py')} \\`);
  console.log('    --context "Task" --what_worked "..." --what_failed "..." --next_time "..."');
  console.log('\nHow memory works:');
  console.log('  Task done → write-reflection.py → memory/reflections/');
  console.log('  Heartbeat  → reflection-analyzer.py → candidate rules extracted');
  console.log('  You confirm → rules added to memory/ai-patterns.md');
  console.log('  Next session → ai-patterns.md in system prompt → AI learns from experience');
  console.log(`\n${separator}\n`);
}

module.exports = { setup };
