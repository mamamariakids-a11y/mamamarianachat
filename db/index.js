const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { seedIfEmpty } = require('./seed-data');

// DATA_DIR lets you point the database (and, via utils/upload.js, uploaded
// files) at a persistent disk when deploying to a host with an otherwise
// ephemeral filesystem (e.g. Render's mounted Disk). Locally it just
// defaults to this db/ folder, so nothing changes for local development.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'mamamaria.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Auto-seed on first boot so a fresh deployment is immediately usable
// without needing shell access to run `npm run seed` manually.
const didSeed = seedIfEmpty(db);
if (didSeed) {
  console.log('تمت تعبئة قاعدة البيانات ببيانات أولية تلقائيًا (أول تشغيل).');
}

module.exports = db;
module.exports.DATA_DIR = DATA_DIR;
