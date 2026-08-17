const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const { seedIfEmpty } = require('./seed-data');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Two ways to run this app, using the exact same code:
//
// 1) Locally / no setup: leave TURSO_DATABASE_URL unset and the app stores
//    everything in a local file (db/mamamaria.db) — nothing to configure.
// 2) Deployed (e.g. on Render's free tier): set TURSO_DATABASE_URL and
//    TURSO_AUTH_TOKEN to a free https://turso.tech database. This makes the
//    data persist reliably even though the host's own filesystem is wiped
//    on every restart/redeploy — no paid disk needed.
const LOCAL_DB_PATH = path.join(__dirname, 'mamamaria.db');
const url = process.env.TURSO_DATABASE_URL || `file:${LOCAL_DB_PATH}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient({ url, authToken });

// SQLite (and libSQL) cannot ALTER a CHECK constraint in place. When a new
// role is added to the app (e.g. 'staff'), an already-deployed database still
// has the old, narrower constraint baked into its `users` table and would
// reject inserting that role with a CHECK-constraint error. This rebuilds
// the table with the up-to-date constraint, preserving every existing row,
// and only runs when needed (a fresh install already gets the new
// constraint straight from schema.sql, so this is a no-op there).
async function migrateUsersRoleCheck() {
  const existing = await db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
  if (!existing.rows.length) return; // fresh install — schema.sql below creates it correctly
  const currentSql = String(existing.rows[0].sql || '');
  if (currentSql.includes("'staff'")) return; // already up to date

  try {
    await db.execute('PRAGMA foreign_keys = OFF');
  } catch (e) {
    // ignore if unsupported
  }
  await db.execute(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','director','teacher','parent','staff')),
      phone TEXT,
      avatar_color TEXT DEFAULT '#5B8DEF',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    INSERT INTO users_new (id, name, email, password_hash, role, phone, avatar_color, active, created_at)
    SELECT id, name, email, password_hash, role, phone, avatar_color, active, created_at FROM users
  `);
  await db.execute('DROP TABLE users');
  await db.execute('ALTER TABLE users_new RENAME TO users');
  try {
    await db.execute('PRAGMA foreign_keys = ON');
  } catch (e) {
    // ignore if unsupported
  }
}

async function init() {
  await migrateUsersRoleCheck();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await db.executeMultiple(schema);
  try {
    await db.execute('PRAGMA foreign_keys = ON');
  } catch (e) {
    // Not critical if the underlying engine ignores this pragma.
  }

  const didSeed = await seedIfEmpty(db);
  if (didSeed) {
    console.log('تمت تعبئة قاعدة البيانات ببيانات أولية تلقائيًا (أول تشغيل).');
  }
}

// Exposed so app.js/db/seed.js can wait for schema+seed before serving requests.
db.ready = init();

module.exports = db;
