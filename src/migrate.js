'use strict';

/**
 * migrate.js — Safe upgrade framework for knight-os
 *
 * Design principles:
 *   1. Data and code live in different places — npm upgrades never touch user data
 *   2. Version file (.knight-version) tracks the data format version
 *   3. Before any migration: full backup to .knight-backups/<timestamp>/
 *   4. Migrations only ADD or TRANSFORM — never delete user content
 *   5. Protected files (SOUL/MEMORY/USER/REDLINES) are never touched
 */

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Current data format version expected by this version of knight-os */
const CURRENT_DATA_VERSION = 1;

/** Version file stored in the workspace root */
const VERSION_FILE = '.knight-version';

/** Backup directory inside the workspace */
const BACKUP_DIR = '.knight-backups';

/** Files that must never be overwritten during migration */
const PROTECTED_FILES = ['SOUL.md', 'MEMORY.md', 'USER.md', 'REDLINES.md'];

// ─────────────────────────────────────────────────────────────
// Version helpers
// ─────────────────────────────────────────────────────────────

/**
 * Read the data version from the workspace.
 * Returns 0 if the file doesn't exist (pre-versioning install).
 */
function readDataVersion(workspace) {
  const versionPath = path.join(workspace, VERSION_FILE);
  if (!fs.existsSync(versionPath)) return 0;
  const raw = fs.readFileSync(versionPath, 'utf8').trim();
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Write the data version to the workspace.
 */
function writeDataVersion(workspace, version) {
  const versionPath = path.join(workspace, VERSION_FILE);
  fs.writeFileSync(versionPath, String(version) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────
// Backup
// ─────────────────────────────────────────────────────────────

/**
 * Recursively copy files from src to dst, skipping .knight-backups itself.
 */
function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === BACKUP_DIR) continue; // don't backup backups
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * Create a timestamped backup of the entire workspace.
 * Returns the backup path so callers can report it to the user.
 */
function backupWorkspace(workspace) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = path.join(workspace, BACKUP_DIR, timestamp);
  console.log(`  📦 Backing up workspace to ${backupPath} …`);
  copyDirRecursive(workspace, backupPath);
  console.log(`  ✅ Backup complete.`);
  return backupPath;
}

// ─────────────────────────────────────────────────────────────
// Migration registry
// ─────────────────────────────────────────────────────────────

/**
 * Each migration:
 *   from    — data version before this migration
 *   to      — data version after this migration
 *   desc    — human-readable description
 *   run(workspace) — the actual migration function; must not throw on clean workspaces
 */
const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    desc: 'Bootstrap versioning — record baseline data version for existing installs',
    run(workspace) {
      // Ensure memory subdirectories exist (previously optional)
      const memoryDirs = [
        'memory/logs',
        'memory/projects',
        'memory/templates',
        'memory/references',
      ];
      for (const dir of memoryDirs) {
        const fullPath = path.join(workspace, dir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
          console.log(`  📁 Created missing directory: ${dir}/`);
        }
      }

      // Add UPGRADE.md so users know migration ran
      const upgradePath = path.join(workspace, 'UPGRADE.md');
      if (!fs.existsSync(upgradePath)) {
        fs.writeFileSync(
          upgradePath,
          [
            '# Upgrade Log',
            '',
            'knight-os upgrade history for this workspace.',
            'This file is auto-maintained — do not edit.',
            '',
          ].join('\n'),
          'utf8'
        );
      }
      // Append an entry
      const entry = `\n## v1 — ${new Date().toISOString().slice(0, 10)}\n- Baseline version established\n- memory/ subdirectories ensured\n`;
      fs.appendFileSync(upgradePath, entry, 'utf8');
    },
  },

  // ── Future migrations go here ──────────────────────────────
  //
  // Example v1 → v2:
  // {
  //   from: 1,
  //   to: 2,
  //   desc: 'Rename ai-patterns.md → noa-patterns.md',
  //   run(workspace) {
  //     const oldPath = path.join(workspace, 'memory', 'ai-patterns.md');
  //     const newPath = path.join(workspace, 'memory', 'noa-patterns.md');
  //     if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
  //       fs.renameSync(oldPath, newPath);
  //     }
  //   },
  // },
];

// ─────────────────────────────────────────────────────────────
// Migration runner
// ─────────────────────────────────────────────────────────────

/**
 * Check if the workspace data is up to date.
 * Returns { needsMigration: bool, currentVersion: number, targetVersion: number }
 */
function checkVersion(workspace) {
  const currentVersion = readDataVersion(workspace);
  return {
    needsMigration: currentVersion < CURRENT_DATA_VERSION,
    currentVersion,
    targetVersion: CURRENT_DATA_VERSION,
  };
}

/**
 * Run all pending migrations for the workspace.
 *
 * - Skips silently if already up to date.
 * - Creates a backup before running any migrations.
 * - Runs migrations in order, updating the version file after each one.
 * - If a migration throws, stops immediately (version file reflects last successful step).
 *
 * Returns { migrated: bool, backupPath: string|null, error: Error|null }
 */
function runMigrations(workspace) {
  if (!fs.existsSync(workspace)) {
    return { migrated: false, backupPath: null, error: null };
  }

  const { needsMigration, currentVersion, targetVersion } = checkVersion(workspace);

  if (!needsMigration) {
    return { migrated: false, backupPath: null, error: null };
  }

  const pending = MIGRATIONS.filter(
    (m) => m.from >= currentVersion && m.to <= targetVersion
  ).sort((a, b) => a.from - b.from);

  if (pending.length === 0) {
    // No migration steps defined yet — just bump the version
    writeDataVersion(workspace, targetVersion);
    return { migrated: true, backupPath: null, error: null };
  }

  console.log(`\n🔄 knight-os: workspace needs upgrade (v${currentVersion} → v${targetVersion})`);

  // Backup before touching anything
  let backupPath = null;
  try {
    backupPath = backupWorkspace(workspace);
  } catch (err) {
    return {
      migrated: false,
      backupPath: null,
      error: new Error(`Backup failed, aborting migration: ${err.message}`),
    };
  }

  // Run each pending migration
  for (const migration of pending) {
    console.log(`  ⚙️  Migration ${migration.from}→${migration.to}: ${migration.desc}`);
    try {
      migration.run(workspace);
      writeDataVersion(workspace, migration.to);
      console.log(`  ✅ Done.`);
    } catch (err) {
      return {
        migrated: false,
        backupPath,
        error: new Error(
          `Migration ${migration.from}→${migration.to} failed: ${err.message}\n` +
            `Your data is backed up at: ${backupPath}`
        ),
      };
    }
  }

  console.log(`\n✅ Workspace upgraded to v${targetVersion}. Backup kept at:\n   ${backupPath}\n`);
  return { migrated: true, backupPath, error: null };
}

// ─────────────────────────────────────────────────────────────
// Template refresh (for `knight upgrade` command)
// ─────────────────────────────────────────────────────────────

/**
 * Refresh non-protected template files in the workspace.
 * Protected files (SOUL/MEMORY/USER/REDLINES) are always skipped.
 * For all other files: only write if the file doesn't exist yet (safe default).
 * Pass { force: true } to overwrite non-protected existing files.
 *
 * Returns { added: string[], skipped: string[] }
 */
function refreshTemplates(workspace, templatesDir, opts) {
  opts = opts || {};
  const added = [];
  const skipped = [];

  function walk(dir, base) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = path.relative(base, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), base);
        continue;
      }
      const isRoot = !relPath.includes(path.sep);
      const isProtected = isRoot && PROTECTED_FILES.includes(entry.name);
      if (isProtected) {
        skipped.push(relPath + ' (protected)');
        continue;
      }
      const dest = path.join(workspace, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest) || opts.force) {
        fs.copyFileSync(path.join(dir, entry.name), dest);
        added.push(relPath);
      } else {
        skipped.push(relPath);
      }
    }
  }

  walk(templatesDir, templatesDir);
  return { added, skipped };
}

// ─────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────

module.exports = {
  CURRENT_DATA_VERSION,
  PROTECTED_FILES,
  readDataVersion,
  writeDataVersion,
  backupWorkspace,
  checkVersion,
  runMigrations,
  refreshTemplates,
};
