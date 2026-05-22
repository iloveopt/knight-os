'use strict';

/**
 * knight rollback
 *
 * Lists available workspace backups and restores a selected one.
 *
 * Behaviour:
 *   - Shows all backups in .knight-backups/ sorted newest-first
 *   - Before restoring, saves a pre-rollback snapshot of the current workspace
 *   - Never restores SOUL.md / MEMORY.md / USER.md / REDLINES.md
 *     (personal identity and memory are always kept as-is)
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const BACKUP_DIR      = '.knight-backups';
const PROTECTED_FILES = new Set(['SOUL.md', 'MEMORY.md', 'USER.md', 'REDLINES.md']);

// ── Helpers ────────────────────────────────────────────────────────────────

function ask(rl, question, defaultVal) {
  return new Promise(resolve => {
    rl.question(question + ' ', answer => {
      resolve(answer.trim() === '' ? defaultVal : answer.trim());
    });
  });
}

/**
 * Recursively copy files from src to dst.
 * Skips .knight-backups to avoid nesting.
 * When skipProtected=true, also skips SOUL/MEMORY/USER/REDLINES at workspace root.
 */
function copyDirRecursive(src, dst, { skipProtected = false, rootLevel = true } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === BACKUP_DIR) continue;
    if (skipProtected && rootLevel && PROTECTED_FILES.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath, { skipProtected, rootLevel: false });
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * Create a timestamped backup of the current workspace.
 * Returns the backup directory path.
 */
function snapshotWorkspace(workspace, suffix) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const label     = suffix ? `${timestamp}-${suffix}` : timestamp;
  const backupPath = path.join(workspace, BACKUP_DIR, label);
  copyDirRecursive(workspace, backupPath);
  return backupPath;
}

/**
 * List available backups sorted newest-first.
 * Returns array of { label, fullPath }.
 */
function listBackups(workspace) {
  const backupRoot = path.join(workspace, BACKUP_DIR);
  if (!fs.existsSync(backupRoot)) return [];
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ label: e.name, fullPath: path.join(backupRoot, e.name) }))
    .sort((a, b) => b.label.localeCompare(a.label)); // newest first
}

// ── Main ───────────────────────────────────────────────────────────────────

async function rollback(config, workspace) {
  console.log('\n🔄 knight rollback\n');

  const backups = listBackups(workspace);

  if (backups.length === 0) {
    console.log('  No backups found in', path.join(workspace, BACKUP_DIR));
    console.log('  Run `knight upgrade` to create a backup automatically.\n');
    process.exit(0);
  }

  // Show list
  console.log('📦 Available backups (newest first):\n');
  backups.forEach((b, i) => {
    const tag = i === 0 ? '  ← latest' : '';
    console.log(`  ${i + 1}. ${b.label}${tag}`);
  });
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let choice;
  try {
    const raw = await ask(rl, `Restore which backup? [1]:`, '1');
    const idx = parseInt(raw, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= backups.length) {
      console.log('\n  Invalid selection. Aborting.\n');
      rl.close();
      process.exit(1);
    }
    choice = backups[idx];
  } catch (e) {
    rl.close();
    process.exit(1);
  }

  console.log(`\n  Selected: ${choice.label}`);
  console.log(`\n  Protected files will NOT be restored:`);
  console.log(`  SOUL.md, MEMORY.md, USER.md, REDLINES.md\n`);
  console.log(`  ⚠️  All other workspace files will be overwritten.`);
  console.log(`  A snapshot of your current state will be saved first.\n`);

  const confirm = await ask(rl, 'Confirm rollback? [y/N]:', 'N');
  rl.close();

  if (!confirm.toLowerCase().startsWith('y')) {
    console.log('\n  Rollback cancelled.\n');
    process.exit(0);
  }

  // Snapshot current state before overwriting
  console.log('\n  📦 Saving current state before rollback …');
  const preSnapshotPath = snapshotWorkspace(workspace, 'pre-rollback');
  console.log(`  ✅ Snapshot saved to:\n     ${preSnapshotPath}\n`);

  // Restore (skip protected files)
  console.log(`  ⏪ Restoring from ${choice.label} …`);
  copyDirRecursive(choice.fullPath, workspace, { skipProtected: true, rootLevel: true });
  console.log(`  ✅ Restore complete.\n`);

  console.log('✅ Rollback done.\n');
  console.log(`  Restored from:  ${choice.label}`);
  console.log(`  Pre-rollback snapshot kept at:`);
  console.log(`  ${preSnapshotPath}`);
  console.log(`\n  If you need to undo this rollback, run \`knight rollback\` again`);
  console.log(`  and pick the pre-rollback snapshot.\n`);
}

module.exports = { rollback };
