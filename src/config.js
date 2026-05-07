'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULTS = {
  workspace: '~/.openclaw/workspace',
  ai_name: 'Knight',
  user_name: 'User',
  timezone: 'UTC',
  storage: {
    backend: 'local',
    local: {
      reflections_dir: 'memory/reflections',
      logs_dir: 'memory/logs',
      memory_file: 'MEMORY.md',
    },
    supabase: {
      url: '',
      service_key: '',
      enabled: false,
    },
  },
  notifications: {
    backend: 'none',
    telegram: {
      bot_token: '',
      chat_id: '',
      enabled: false,
    },
  },
  heartbeat: {
    interval_hours: 6,
    enabled: false,
    tasks: ['reflection_analysis', 'memory_scan', 'log_compress'],
  },
  reflection: {
    min_pattern_count: 2,
    auto_write: true,
  },
};

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function resolveWorkspace(config) {
  let ws = config.workspace || DEFAULTS.workspace;
  if (ws.startsWith('~')) {
    ws = path.join(os.homedir(), ws.slice(1));
  }
  return ws;
}

function applyEnvOverrides(config) {
  if (process.env.KNIGHT_WORKSPACE) {
    config.workspace = process.env.KNIGHT_WORKSPACE;
  }
  if (process.env.KNIGHT_AI_NAME) {
    config.ai_name = process.env.KNIGHT_AI_NAME;
  }
  if (process.env.KNIGHT_USER_NAME) {
    config.user_name = process.env.KNIGHT_USER_NAME;
  }
  if (process.env.KNIGHT_TIMEZONE) {
    config.timezone = process.env.KNIGHT_TIMEZONE;
  }
  if (process.env.SUPABASE_URL) {
    config.storage.supabase.url = process.env.SUPABASE_URL;
  }
  if (process.env.SUPABASE_SERVICE_KEY) {
    config.storage.supabase.service_key = process.env.SUPABASE_SERVICE_KEY;
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    config.notifications.telegram.bot_token = process.env.TELEGRAM_BOT_TOKEN;
  }
  if (process.env.TELEGRAM_CHAT_ID) {
    config.notifications.telegram.chat_id = process.env.TELEGRAM_CHAT_ID;
  }
  return config;
}

function loadConfig() {
  let config = { ...DEFAULTS };

  const globalPath = path.join(os.homedir(), '.knight', 'config.json');
  const globalConfig = readJsonFile(globalPath);
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
  }

  const localPath = path.join(process.cwd(), 'knight.config.json');
  const localConfig = readJsonFile(localPath);
  if (localConfig) {
    config = deepMerge(config, localConfig);
  }

  config = applyEnvOverrides(config);

  return config;
}

module.exports = { loadConfig, resolveWorkspace, DEFAULTS };
