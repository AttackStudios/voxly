// One-time migration: copy the local file DB (server/data/db.json) and uploads
// into the cloud Postgres DB, so your existing accounts/messages/images carry over.
//
//   DATABASE_URL='postgres://...supabase...' node server/migrate.mjs
//
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');

if (!process.env.DATABASE_URL) { console.error('✗ Set DATABASE_URL first.'); process.exit(1); }

const dbFile = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(dbFile)) { console.error('✗ No local db.json found at', dbFile); process.exit(1); }
const state = JSON.parse(fs.readFileSync(dbFile, 'utf8'));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL)');
await pool.query('CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY, mime text, bytes bytea, created_at bigint)');
await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1', [state]);
console.log(`✓ Migrated ${state.users.length} users, ${state.servers.length} servers, ${state.messages.length} messages`);

const upDir = path.join(DATA_DIR, 'uploads');
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
let n = 0;
for (const f of fs.existsSync(upDir) ? fs.readdirSync(upDir) : []) {
  if (f.endsWith('.mime')) continue;
  const bytes = fs.readFileSync(path.join(upDir, f));
  let mime = 'application/octet-stream';
  try { mime = fs.readFileSync(path.join(upDir, f + '.mime'), 'utf8').trim(); }
  catch { mime = MIME[f.split('.').pop().toLowerCase()] || mime; }
  await pool.query('INSERT INTO uploads (id, mime, bytes, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [f, mime, bytes, Date.now()]);
  n++;
}
console.log(`✓ Migrated ${n} uploaded image(s)`);
await pool.end();
process.exit(0);
