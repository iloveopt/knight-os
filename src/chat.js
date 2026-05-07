'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

function loadEnv(workspace) {
  const envPath = path.join(workspace, '.env');
  const vars = {};
  if (!fs.existsSync(envPath)) return vars;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    vars[key] = val;
  }
  return vars;
}

function loadSystemPrompt(workspace, config) {
  const files = (config.model && config.model.system_prompt_files) || [
    'SOUL.md',
    'AGENTS.md',
    'MEMORY.md',
    'REDLINES.md',
  ];
  const loaded = [];
  const parts = [];

  for (const file of files) {
    const filePath = path.join(workspace, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) continue;
    parts.push(`<!-- ${file} -->\n${content}`);
    loaded.push(file);
  }

  return { systemPrompt: parts.join('\n\n'), loadedFiles: loaded };
}

function callAnthropic(apiKey, model, messages, systemPrompt, maxTokens, onChunk) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      stream: true,
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 401) {
        reject(new Error('Invalid API key. Check your ANTHROPIC_API_KEY.'));
        return;
      }

      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const err = JSON.parse(data);
            reject(
              new Error(
                `API error (${err.error?.type || res.statusCode}): ${err.error?.message || data}`
              )
            );
          } catch {
            reject(new Error(`API error (${res.statusCode}): ${data}`));
          }
        });
        return;
      }

      let buffer = '';
      let fullText = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const event = JSON.parse(payload);
            if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta'
            ) {
              const text = event.delta.text;
              fullText += text;
              onChunk(text);
            }
          } catch {
            // skip malformed events
          }
        }
      });

      res.on('end', () => resolve(fullText));
    });

    req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

async function chat(config, workspace) {
  const model = (config.model && config.model.name) || 'claude-sonnet-4-5';
  const maxTokens = (config.model && config.model.max_tokens) || 8096;

  const env = loadEnv(workspace);
  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.log('\nNo Anthropic API key found.');
    console.log(
      'Run `knight init` to configure, or set ANTHROPIC_API_KEY in your workspace .env file.\n'
    );
    process.exit(1);
  }

  const { systemPrompt, loadedFiles } = loadSystemPrompt(workspace, config);

  const separator = '──────────────────────────────────────────────────────';

  console.log(`\nKnight Chat — ${model}`);
  if (loadedFiles.length > 0) {
    console.log(
      `System prompt loaded from: ${loadedFiles.join(', ')} (${loadedFiles.length} files)`
    );
  } else {
    console.log('System prompt: (no files found)');
  }
  console.log('Type /exit or Ctrl+C to quit, /clear to reset history, /memory to view system prompt');
  console.log(separator);

  const messages = [];
  let turns = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askUser = () => {
    return new Promise((resolve) => {
      rl.question('\nYou: ', (answer) => resolve(answer));
    });
  };

  const shutdown = () => {
    console.log(`\nGoodbye. Conversation had ${turns} turns.`);
    rl.close();
    process.exit(0);
  };

  rl.on('close', shutdown);

  while (true) {
    const input = await askUser();
    if (input === null || input === undefined) break;

    const trimmed = input.trim();
    if (!trimmed) continue;

    if (trimmed === '/exit') {
      console.log(`\nGoodbye. Conversation had ${turns} turns.`);
      rl.close();
      process.exit(0);
    }

    if (trimmed === '/clear') {
      messages.length = 0;
      turns = 0;
      console.log('History cleared.');
      continue;
    }

    if (trimmed === '/memory') {
      console.log(`\n${separator}`);
      console.log(systemPrompt || '(empty system prompt)');
      console.log(separator);
      continue;
    }

    if (trimmed === '/help') {
      console.log('\nCommands:');
      console.log('  /exit   — Exit chat');
      console.log('  /clear  — Clear conversation history');
      console.log('  /memory — Show system prompt');
      console.log('  /help   — Show this help');
      continue;
    }

    messages.push({ role: 'user', content: trimmed });

    process.stdout.write('\nAssistant: ');

    try {
      const reply = await callAnthropic(apiKey, model, messages, systemPrompt, maxTokens, (chunk) => {
        process.stdout.write(chunk);
      });
      process.stdout.write('\n');
      messages.push({ role: 'assistant', content: reply });
      turns++;
    } catch (err) {
      process.stdout.write('\n');
      console.log(`Error: ${err.message}`);
    }

    console.log(separator);
  }
}

module.exports = { chat, loadEnv, loadSystemPrompt, callAnthropic };
