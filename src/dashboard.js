'use strict';

/**
 * knight dashboard
 *
 * Reads the local workspace and generates a self-contained HTML dashboard.
 * Zero external dependencies – no Vercel, no Supabase, no cloud account needed.
 *
 * Usage:
 *   knight dashboard                  → writes dashboard.html, opens in browser
 *   knight dashboard --output out.html → custom output path, still opens
 *   knight dashboard --no-open        → write only, don't open browser
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ── Helpers ────────────────────────────────────────────────────────────────

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function countLines(text) {
  if (!text) return 0;
  return text.split('\n').length;
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function openInBrowser(filePath) {
  const url = 'file://' + filePath;
  try {
    if (process.platform === 'darwin') execSync(`open "${url}"`);
    else if (process.platform === 'win32') execSync(`start "" "${url}"`);
    else execSync(`xdg-open "${url}"`);
  } catch {
    // silent – not critical
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Data collection ────────────────────────────────────────────────────────

function collectData(workspace, config) {
  const aiName   = config.ai_name   || 'Knight';
  const userName = config.user_name || 'User';

  // Rules from ai-patterns.md (or legacy noa-patterns.md)
  let patternsPath = path.join(workspace, 'memory', 'ai-patterns.md');
  if (!fs.existsSync(patternsPath)) {
    patternsPath = path.join(workspace, 'memory', 'noa-patterns.md');
  }
  const patternsText = readFile(patternsPath);
  const totalRuleLines = countLines(patternsText);
  // Count numbered rules flexibly: matches lines like "1. **rule**", "- rule", or plain "## RULE" headings
  // Tries specific format first, falls back to counting any non-empty list/heading lines
  let coreRules = countMatches(patternsText, /^\d+\.\s+/gm);
  if (coreRules === 0) coreRules = countMatches(patternsText, /^[-*]\s+\S/gm);
  if (coreRules === 0) coreRules = countMatches(patternsText, /^#{1,3}\s+\S/gm);
  const badPatterns = countMatches(patternsText, /^\|\s*\d+\s*\|/gm);

  // Projects from PROJECTS.md
  const projectsText = readFile(path.join(workspace, 'PROJECTS.md'));
  // Count table rows that look like real project entries (have | and a path)
  const projectRows = countMatches(projectsText, /^\|[^\-|][^|]+\|[^|]*memory\/projects[^|]*\|/gm);
  // Extract active project names
  const activeProjects = [];
  const projectLineRe = /^\|\s*([^|]+?)\s*\|\s*[^|]+memory\/projects[^|]+\|\s*(?:🟢\s*)?进行中[^|]*\|/gm;
  let m;
  while ((m = projectLineRe.exec(projectsText)) !== null) {
    const name = m[1].trim().replace(/\[.*?\]/g, '').trim();
    if (name && name !== '项目') activeProjects.push(name);
  }

  // Also pick up rows with plain "进行中" (no emoji)
  const activeProjRe2 = /^\|\s*([^|]+?)\s*\|\s*memory\/projects[^|]+\|\s*进行中/gm;
  while ((m = activeProjRe2.exec(projectsText)) !== null) {
    const name = m[1].trim().replace(/\[.*?\]/g, '').trim();
    if (name && name !== '项目' && !activeProjects.includes(name)) activeProjects.push(name);
  }

  // Recent daily logs
  const memDir = path.join(workspace, 'memory');
  const allMemFiles = listDir(memDir).filter(f => /^\d{4}-\d{2}-\d{2}/.test(f)).sort().reverse();
  const recentLogs = allMemFiles.slice(0, 5).map(f => {
    const dateStr = f.replace('.md', '').substring(0, 10);
    const content = readFile(path.join(memDir, f));
    // Pull first meaningful heading
    const headingMatch = content.match(/^##\s+(.+)$/m);
    const summary = headingMatch ? headingMatch[1] : f;
    return { date: dateStr, filename: f, summary };
  });

  // Reflections
  const reflDir = path.join(workspace, 'memory', 'reflections');
  const reflFiles = listDir(reflDir).filter(f => f.endsWith('.md') || f.endsWith('.json') || f.endsWith('.jsonl'));
  const reflCount = reflFiles.length;

  // Session / log count
  const logsDir = path.join(workspace, 'memory', 'logs');
  const logFiles = listDir(logsDir).filter(f => f.endsWith('.md'));

  // knight-os version from package.json up one level (when installed globally, not available)
  let knightVersion = 'latest';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    knightVersion = 'v' + pkg.version;
  } catch { /* ok */ }

  // Count unique days that have a daily log entry (true active days, not days since first log)
  const activeDays = allMemFiles.length;

  // Heartbeat interval from config (default 6h)
  const heartbeatInterval = (config.heartbeat && config.heartbeat.interval_hours)
    ? `${config.heartbeat.interval_hours}h`
    : '6h';

  const generatedAt = new Date().toISOString().substring(0, 10);

  return {
    aiName, userName,
    totalRuleLines, coreRules, badPatterns,
    projectRows, activeProjects,
    recentLogs, reflCount, logFiles: logFiles.length,
    knightVersion, activeDays, generatedAt, heartbeatInterval,
  };
}

// ── HTML generation ────────────────────────────────────────────────────────

function buildHTML(d) {
  const projectsHTML = d.activeProjects.slice(0, 8).map((name, i) => {
    const colors = ['#7c6af7', '#4fd1a5', '#f7a84a', '#f76a6a', '#64b5f6', '#ce93d8', '#80cbc4', '#ffcc02'];
    const color = colors[i % colors.length];
    return `
    <div class="proj-item">
      <div class="proj-dot" style="background:${color}"></div>
      <span class="proj-name">${esc(name)}</span>
    </div>`;
  }).join('');

  const extraProjects = d.projectRows > d.activeProjects.length
    ? `<div class="proj-more">+ ${d.projectRows - d.activeProjects.length} 个项目</div>`
    : '';

  const timelineHTML = d.recentLogs.map((log, i) => {
    const isLast = i === d.recentLogs.length - 1;
    const colors = ['#7c6af7', '#4fd1a5', '#f7a84a', '#7c6af7', '#4fd1a5'];
    const color = colors[i % colors.length];
    return `
    <li class="tl-item">
      <div class="tl-dot-wrap">
        <div class="tl-dot" style="background:${color}"></div>
        ${!isLast ? '<div class="tl-line"></div>' : ''}
      </div>
      <span class="tl-time">${esc(log.date.substring(5))}</span>
      <div class="tl-content">
        <div class="tl-title">${esc(log.summary)}</div>
        <div class="tl-sub">${esc(log.filename)}</div>
      </div>
    </li>`;
  }).join('');

  // Level bar: scale relative to rules count (every 5 rules = 25%; cap at 100%)
  const levelPct = d.coreRules === 0 ? 0 : Math.min(100, Math.round((d.coreRules / Math.max(d.coreRules, 20)) * 100));

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Knight Dashboard — ${esc(d.userName)} × ${esc(d.aiName)}</title>
<style>
  :root {
    --bg: #0d0d0f;
    --surface: #141417;
    --surface2: #1c1c21;
    --border: #2a2a32;
    --accent: #7c6af7;
    --accent2: #4fd1a5;
    --accent3: #f7a84a;
    --text: #e8e6f0;
    --text2: #8b8899;
    --text3: #5a5868;
    --green: #4fd1a5;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: -apple-system, 'SF Pro Display', 'PingFang SC', 'Helvetica Neue', sans-serif;
    min-height: 100vh; padding-bottom: 60px;
  }

  /* Header */
  .header {
    border-bottom: 1px solid var(--border); padding: 18px 32px;
    display: flex; align-items: center; justify-content: space-between;
    background: var(--surface);
  }
  .logo { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
  .badge {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 20px; padding: 3px 10px; font-size: 11px; color: var(--text2);
  }
  .dot-live { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .header-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--text3); }

  /* Layout */
  .container { max-width: 1080px; margin: 0 auto; padding: 28px 20px 0; }

  /* Hero */
  .hero {
    display: flex; align-items: center; justify-content: space-between;
    background: linear-gradient(135deg, #1a1525 0%, #131320 60%, #0d1a1a 100%);
    border: 1px solid var(--border); border-radius: 16px;
    padding: 30px 36px; margin-bottom: 20px; position: relative; overflow: hidden;
  }
  .hero::before {
    content: ''; position: absolute; top: -80px; right: -80px;
    width: 240px; height: 240px;
    background: radial-gradient(circle, rgba(124,106,247,0.12) 0%, transparent 70%);
    pointer-events: none;
  }
  .hero-left h1 { font-size: 24px; font-weight: 700; margin-bottom: 6px; }
  .hero-left h1 span { color: var(--accent); }
  .hero-left p { font-size: 13px; color: var(--text2); line-height: 1.6; }
  .hero-tags { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
  .hero-tag {
    font-size: 11px; border-radius: 20px; padding: 3px 10px;
    background: rgba(124,106,247,0.1); border: 1px solid rgba(124,106,247,0.2);
    color: var(--accent);
  }
  .hero-stats { display: flex; gap: 28px; flex-shrink: 0; }
  .stat-box { text-align: center; }
  .stat-num { font-size: 30px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
  .stat-label { font-size: 10px; color: var(--text3); text-transform: uppercase; letter-spacing: 0.06em; }

  /* Grid */
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .grid-2 { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px; }
  @media (max-width: 768px) {
    .grid-3, .grid-2 { grid-template-columns: 1fr; }
    .hero { flex-direction: column; gap: 24px; }
    .hero-stats { justify-content: space-around; width: 100%; }
    .header { flex-direction: column; gap: 10px; align-items: flex-start; }
  }

  /* Card */
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px 22px;
  }
  .card-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text3); margin-bottom: 16px;
    display: flex; align-items: center; gap: 6px;
  }

  /* Evolution */
  .evo-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 9px 0; border-bottom: 1px solid var(--border);
  }
  .evo-row:last-child { border-bottom: none; padding-bottom: 0; }
  .evo-label { font-size: 13px; color: var(--text2); }
  .evo-val { font-size: 16px; font-weight: 700; }
  .evo-val.ac { color: var(--accent); }
  .evo-val.gr { color: var(--green); }

  /* Level bar */
  .lvl-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .lvl-label { font-size: 13px; color: var(--text2); }
  .lvl-val { font-size: 13px; font-weight: 600; color: var(--accent); }
  .bar-track { background: var(--surface2); border-radius: 6px; height: 6px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--accent), #a090ff); }
  .lvl-desc { font-size: 11px; color: var(--text3); margin-top: 6px; }

  /* Stat boxes */
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat-mini {
    background: var(--surface2); border-radius: 8px; padding: 12px 14px; text-align: center;
  }
  .stat-mini-num { font-size: 24px; font-weight: 700; line-height: 1; margin-bottom: 3px; }
  .stat-mini-label { font-size: 10px; color: var(--text3); }

  /* Projects */
  .proj-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 0; border-bottom: 1px solid var(--border);
  }
  .proj-item:last-child { border-bottom: none; }
  .proj-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .proj-name { font-size: 13px; color: var(--text); }
  .proj-more { font-size: 12px; color: var(--text3); padding-top: 8px; }

  /* Timeline */
  .timeline { list-style: none; }
  .tl-item { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); }
  .tl-item:last-child { border-bottom: none; }
  .tl-dot-wrap { display: flex; flex-direction: column; align-items: center; padding-top: 3px; }
  .tl-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .tl-line { flex: 1; width: 1px; background: var(--border); margin-top: 4px; }
  .tl-time { font-size: 11px; color: var(--text3); white-space: nowrap; min-width: 46px; padding-top: 1px; }
  .tl-content { flex: 1; }
  .tl-title { font-size: 13px; color: var(--text); font-weight: 500; line-height: 1.4; }
  .tl-sub { font-size: 11px; color: var(--text3); margin-top: 2px; }

  /* Footer */
  .footer {
    text-align: center; margin-top: 36px;
    font-size: 11px; color: var(--text3);
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .footer a { color: var(--text3); text-decoration: none; }
  .footer a:hover { color: var(--text2); }
</style>
</head>
<body>

<div class="header">
  <div class="logo">🦞 Knight Dashboard</div>
  <div class="header-meta">
    <span class="badge"><span class="dot-live"></span>knight-os ${esc(d.knightVersion)}</span>
    <span>生成于 ${esc(d.generatedAt)}</span>
  </div>
</div>

<div class="container">

  <!-- Hero -->
  <div class="hero">
    <div class="hero-left">
      <h1>${esc(d.userName)} × <span>${esc(d.aiName)}</span></h1>
      <p>你的 AI 记住了你，学会了你的规则，<br>正在一起构建接下来的一切。</p>
      <div class="hero-tags">
        <span class="badge"><span class="dot-live"></span>workspace 运行中</span>
        ${d.recentLogs.length > 0 ? `<span class="hero-tag">⚡ 最近活跃：${esc(d.recentLogs[0].date.substring(5))}</span>` : ''}
      </div>
    </div>
    <div class="hero-stats">
      <div class="stat-box">
        <div class="stat-num" style="color:var(--accent)">${d.coreRules || d.totalRuleLines}</div>
        <div class="stat-label">AI 规则</div>
      </div>
      <div class="stat-box">
        <div class="stat-num" style="color:var(--green)">${d.projectRows || d.activeProjects.length}</div>
        <div class="stat-label">项目</div>
      </div>
      <div class="stat-box">
        <div class="stat-num" style="color:var(--accent3)">${d.activeDays || '—'}</div>
        <div class="stat-label">有记录的天数</div>
      </div>
    </div>
  </div>

  <!-- Row 1 -->
  <div class="grid-3">

    <!-- AI Evolution -->
    <div class="card">
      <div class="card-title">🧠 AI 进化状态</div>
      <div class="lvl-header">
        <span class="lvl-label">规则完整度</span>
        <span class="lvl-val">${levelPct}%</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${levelPct}%"></div></div>
      <div class="lvl-desc">来自 memory/ai-patterns.md · ${d.totalRuleLines} 行</div>
      <div style="margin-top:14px">
        <div class="evo-row">
          <span class="evo-label">CORE 规则</span>
          <span class="evo-val ac">${d.coreRules} 条</span>
        </div>
        <div class="evo-row">
          <span class="evo-label">BAD patterns</span>
          <span class="evo-val ac">${d.badPatterns} 条</span>
        </div>
        <div class="evo-row">
          <span class="evo-label">Reflections</span>
          <span class="evo-val gr">${d.reflCount} 条</span>
        </div>
        <div class="evo-row">
          <span class="evo-label">日志文件</span>
          <span class="evo-val">${d.logFiles + d.recentLogs.length}</span>
        </div>
      </div>
    </div>

    <!-- Projects -->
    <div class="card">
      <div class="card-title">🗂 活跃项目</div>
      ${projectsHTML || '<p style="font-size:13px;color:var(--text3)">暂无项目数据，运行 knight setup 初始化 PROJECTS.md</p>'}
      ${extraProjects}
    </div>

    <!-- Stats -->
    <div class="card">
      <div class="card-title">📊 数据概览</div>
      <div class="stat-grid">
        <div class="stat-mini">
          <div class="stat-mini-num" style="color:var(--accent)">${d.coreRules}</div>
          <div class="stat-mini-label">核心规则</div>
        </div>
        <div class="stat-mini">
          <div class="stat-mini-num" style="color:var(--green)">${d.reflCount}</div>
          <div class="stat-mini-label">Reflections</div>
        </div>
        <div class="stat-mini">
          <div class="stat-mini-num" style="color:var(--accent3)">${d.projectRows}</div>
          <div class="stat-mini-label">注册项目</div>
        </div>
        <div class="stat-mini">
          <div class="stat-mini-num" style="color:var(--text2)">${d.activeDays}</div>
          <div class="stat-mini-label">有记录的天数</div>
        </div>
      </div>
      <div style="margin-top:14px;font-size:11px;color:var(--text3);line-height:1.8">
        闭环：任务完成 → reflection<br>
        → analyzer → 候选规则<br>
        → 确认 → AI 下次更聪明
      </div>
    </div>

  </div>

  <!-- Row 2 -->
  <div class="grid-2">

    <!-- Timeline -->
    <div class="card">
      <div class="card-title">⚡ 最近活动</div>
      ${timelineHTML
        ? `<ul class="timeline">${timelineHTML}</ul>`
        : '<p style="font-size:13px;color:var(--text3)">暂无日志文件，AI 开始工作后会自动生成。</p>'}
    </div>

    <!-- How it works -->
    <div class="card">
      <div class="card-title">🔄 记忆闭环</div>
      <div style="font-size:13px;color:var(--text2);line-height:2;margin-bottom:14px">
        <div>✅ 任务完成</div>
        <div style="padding-left:12px;color:var(--text3)">↓</div>
        <div>✍️ write-reflection.py</div>
        <div style="padding-left:12px;color:var(--text3)">↓</div>
        <div>🔍 reflection-analyzer.py</div>
        <div style="padding-left:12px;color:var(--text3)">↓</div>
        <div>📌 候选规则 → 你确认</div>
        <div style="padding-left:12px;color:var(--text3)">↓</div>
        <div>🧠 ai-patterns.md 更新</div>
        <div style="padding-left:12px;color:var(--text3)">↓</div>
        <div>⚡ 下次会话 AI 更聪明</div>
      </div>
      <div style="font-size:11px;color:var(--text3)">
        Heartbeat 每 ${d.heartbeatInterval} 自动扫描
      </div>
    </div>

  </div>

  <div class="footer">
    <span>🦞 knight-os ${esc(d.knightVersion)}</span>
    <span>·</span>
    <a href="https://www.npmjs.com/package/knight-os" target="_blank">npm</a>
    <span>·</span>
    <a href="https://github.com/iloveopt/knight-os" target="_blank">GitHub</a>
    <span>·</span>
    <span>本地生成 · 无需服务器</span>
  </div>

</div>
</body>
</html>`;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * @param {object} config   - loaded knight config
 * @param {string} workspace - resolved workspace path
 * @param {object} opts
 * @param {string} [opts.output]  - output file path (default: <workspace>/dashboard.html)
 * @param {boolean} [opts.open]   - open in browser after writing (default: true)
 */
function dashboard(config, workspace, opts = {}) {
  opts = Object.assign({ open: true }, opts);

  const outputPath = opts.output || path.join(workspace, 'dashboard.html');

  console.log('\n🦞 Knight Dashboard\n');
  console.log('   Reading workspace data...');

  const data = collectData(workspace, config);

  console.log(`   ${data.aiName} rules: ${data.coreRules} CORE + ${data.badPatterns} BAD patterns`);
  console.log(`   Projects: ${data.projectRows} registered, ${data.activeProjects.length} parsed`);
  console.log(`   Reflections: ${data.reflCount}`);
  console.log(`   Active days: ${data.activeDays}`);

  const html = buildHTML(data);
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log(`\n   ✅ Dashboard written to:\n      ${outputPath}\n`);

  if (opts.open) {
    openInBrowser(outputPath);
  } else {
    console.log('   (use --open to open in browser)\n');
  }
}

module.exports = { dashboard };
