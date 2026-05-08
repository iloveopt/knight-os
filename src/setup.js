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
  // Primary: look for openclaw binary in PATH
  try {
    const result = spawnSync('openclaw', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && !result.error) {
      return { installed: true, version: (result.stdout || '').trim().split('\n')[0] || 'unknown' };
    }
  } catch (_) {}

  // Fallback: check npm global list via JSON output
  try {
    const result = spawnSync('npm', ['list', '-g', 'openclaw', '--depth=0', '--json'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.stdout) {
      const parsed = JSON.parse(result.stdout);
      if (parsed && parsed.dependencies && parsed.dependencies.openclaw) {
        const ver = parsed.dependencies.openclaw.version || 'unknown';
        return { installed: true, version: ver };
      }
    }
  } catch (_) {}

  return { installed: false };
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
    closeAndExit(1);
    return;
  }

  // Step 2: Workspace directory
  console.log('\n[2/6] Workspace configuration');
  const workspaceInput = await ask(rl, 'Workspace directory', DEFAULT_WORKSPACE);
  const workspace = path.resolve(workspaceInput.replace(/^~/, os.homedir()));

  const workspaceExists = fs.existsSync(workspace);
  const hasCoreFiles = workspaceExists && fs.existsSync(path.join(workspace, 'AGENTS.md'));

  // Files that contain user's personal memory/identity — never overwrite by default
  const PROTECTED_FILES = ['SOUL.md', 'MEMORY.md', 'USER.md', 'REDLINES.md'];
  const hasPersonalMemory = hasCoreFiles && PROTECTED_FILES.some(
    f => fs.existsSync(path.join(workspace, f))
  );

  let overwrite = false;
  let overwriteProtected = false;

  if (hasCoreFiles) {
    if (hasPersonalMemory) {
      console.log(`\n⚠️  Existing OpenClaw workspace detected at: ${workspace}`);
      console.log('   Protected files found: SOUL.md, MEMORY.md, USER.md, REDLINES.md');
      console.log('   These contain your personal memory and identity.\n');
      console.log('   Knight OS will add missing files and update scripts/templates.');
      console.log('   Your existing memory files will NOT be touched.\n');
      const answer = await ask(rl, 'Also overwrite protected files? (y/N)', 'N');
      overwriteProtected = answer.toLowerCase().startsWith('y');
      if (overwriteProtected) {
        console.log('\n  ⚠️  Protected files WILL be overwritten. Existing content will be lost.');
      } else {
        console.log('\n  ✅ Protected files preserved. Only missing/new files will be added.');
      }
      overwrite = true; // always write non-protected files (scripts, AGENTS.md, HEARTBEAT.md, PROJECTS.md)
    } else {
      console.log(`\n⚠️  Workspace already exists at: ${workspace}`);
      const answer = await ask(rl, 'Overwrite existing files? (y/N)', 'N');
      overwrite = answer.toLowerCase().startsWith('y');
      overwriteProtected = overwrite;
      if (!overwrite) {
        console.log('\nSkipping template write. Continuing with other setup steps...');
      }
    }
  } else {
    overwrite = true;
    overwriteProtected = true;
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
  if (overwrite || !hasCoreFiles) {
    const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
    const vars = { aiName, userName, timezone, language };

    function fillTemplate(content, v) {
      return content
        .replace(/\{\{AI_NAME\}\}/g, v.aiName)
        .replace(/\{\{USER_NAME\}\}/g, v.userName)
        .replace(/\{\{TIMEZONE\}\}/g, v.timezone)
        .replace(/\{\{LANGUAGE\}\}/g, v.language || 'en')
        .replace(/\{\{CHANNEL\}\}/g, 'direct');
    }

    function copyTemplates(srcDir, destDir, isRoot) {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(srcDir, entry.name);
        const dest = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(dest, { recursive: true });
          copyTemplates(src, dest, false);
        } else {
          // Check if this is a protected file (root level only)
          const isProtected = isRoot && PROTECTED_FILES.includes(entry.name);
          if (isProtected && !overwriteProtected) {
            if (!fs.existsSync(dest)) {
              // File doesn't exist yet — safe to create
              try {
                const content = fs.readFileSync(src, 'utf-8');
                fs.writeFileSync(dest, fillTemplate(content, vars), 'utf-8');
                console.log(`  ✅ ${path.relative(workspace, dest)}`);
              } catch (e) {
                console.log(`  ⚠️  ${path.relative(workspace, dest)}: ${e.message}`);
              }
            } else {
              console.log(`  🔒 ${path.relative(workspace, dest)} (protected, skipped)`);
            }
            continue;
          }
          try {
            const content = fs.readFileSync(src, 'utf-8');
            fs.writeFileSync(dest, fillTemplate(content, vars), 'utf-8');
            console.log(`  ✅ ${path.relative(workspace, dest)}`);
          } catch (e) {
            console.log(`  ⚠️  ${path.relative(workspace, dest)}: ${e.message}`);
          }
        }
      }
    }

    copyTemplates(TEMPLATES_DIR, workspace, true);
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

  console.log(`\n${separator}`);
  console.log('✅ Knight OS setup complete!\n');
  console.log(`Workspace: ${workspace}`);
  console.log('\nNext steps:');
  console.log('  1. Review and customize your SOUL.md (AI personality)');
  console.log('  2. Fill in USER.md (your profile)');
  console.log('  3. Start chatting: openclaw chat\n');
  console.log('How memory works:');
  console.log('  Task done → write-reflection.py → memory/reflections/');
  console.log('  Heartbeat  → reflection-analyzer.py → candidate rules extracted');
  console.log('  You confirm → rules added to memory/ai-patterns.md');
  console.log('  Next session → ai-patterns.md in system prompt → AI learns\n');
  console.log(`${separator}\n`);
}

module.exports = { setup };
