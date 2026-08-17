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

async function init() {
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
