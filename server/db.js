// Dual-mode datastore.
//  • Local / desktop:  pure-JS JSON file (no native modules; atomic writes).
//  • Cloud (Render):   Postgres (Supabase) — set DATABASE_URL to switch on.
//  • Cloud (Render):   Upstash Redis REST — set UPSTASH_REDIS_REST_URL/TOKEN
//                      (no npm dep; keys prefixed `voxly:` so a shared DB is safe).
// In both modes the whole dataset lives in memory and the public API stays
// synchronous; mutations are written through to the backing store. Uploaded
// images go to a separate `uploads` table (PG) or the uploads/ folder (file).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DC_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export const USE_PG = !!process.env.DATABASE_URL;
export const USE_KV = !USE_PG && !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const REMOTE = USE_PG || USE_KV;
let pool = null;

const KV_STATE = 'voxly:state';
async function kv(...cmd) {
  const res = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`upstash ${cmd[0]}: ${data.error || res.status}`);
  return data.result;
}

if (!REMOTE && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!REMOTE) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const EMPTY = {
  users: [], servers: [], channels: [], serverMembers: [],
  messages: [], dmConversations: [], meta: { version: 1 },
};
const clone = (o) => JSON.parse(JSON.stringify(o));
function withCollections(data) {
  for (const k of Object.keys(EMPTY)) if (!(k in data)) data[k] = clone(EMPTY[k]);
  return data;
}

function loadFile() {
  try { return withCollections(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
  catch { return clone(EMPTY); }
}

// file mode can load synchronously at startup; PG mode loads in init()
let state = REMOTE ? clone(EMPTY) : loadFile();

// ---- initialize (must be awaited before serving in PG mode) ----
export async function init() {
  if (USE_KV) {
    const raw = await kv('GET', KV_STATE);
    state = raw ? withCollections(JSON.parse(raw)) : clone(EMPTY);
    console.log('[db] Upstash connected — loaded', state.users.length, 'users');
    return;
  }
  if (!USE_PG) { state = loadFile(); return; }
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 4 });
  await pool.query('CREATE TABLE IF NOT EXISTS app_state (id int PRIMARY KEY, data jsonb NOT NULL)');
  await pool.query('CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY, mime text, bytes bytea, created_at bigint)');
  const r = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (r.rows[0]) state = withCollections(r.rows[0].data);
  else { state = clone(EMPTY); await pool.query('INSERT INTO app_state (id, data) VALUES (1, $1)', [state]); }
  console.log('[db] Postgres connected — loaded', state.users.length, 'users');
}

let writeQueued = false;
function persist() {
  if (writeQueued) return;
  writeQueued = true;
  // Upstash bills per command, so coalesce bursts (typing, presence) into one write.
  const schedule = USE_KV ? (fn) => setTimeout(fn, 1500) : process.nextTick;
  schedule(async () => {
    writeQueued = false;
    try {
      if (USE_KV) await kv('SET', KV_STATE, JSON.stringify(state));
      else if (USE_PG) await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [state]);
      else { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, DB_FILE); }
    } catch (e) { console.error('[db] persist failed:', e.message); }
  });
}

// flush immediately (CLI / shutdown). Works in both modes.
export async function flush() {
  if (USE_KV) await kv('SET', KV_STATE, JSON.stringify(state));
  else if (USE_PG) { if (pool) await pool.query('UPDATE app_state SET data = $1 WHERE id = 1', [state]); }
  else { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, DB_FILE); }
}
// sync flush kept for file-mode CLIs
export function flushSync() {
  if (REMOTE) return; // not supported in cloud modes; use flush()
  const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, DB_FILE);
}

// ---- uploaded images ----
export async function saveUpload(theId, mime, buffer) {
  if (USE_KV) {
    await kv('SET', `voxly:up:${theId}`, JSON.stringify({ mime, b64: buffer.toString('base64') }));
  } else if (USE_PG) {
    await pool.query('INSERT INTO uploads (id, mime, bytes, created_at) VALUES ($1,$2,$3,$4)', [theId, mime, buffer, Date.now()]);
  } else {
    fs.writeFileSync(path.join(UPLOADS_DIR, theId), buffer);
    fs.writeFileSync(path.join(UPLOADS_DIR, theId + '.mime'), mime);
  }
}
export async function getUpload(theId) {
  if (USE_KV) {
    const raw = await kv('GET', `voxly:up:${theId}`);
    if (!raw) return null;
    const { mime, b64 } = JSON.parse(raw);
    return { mime, bytes: Buffer.from(b64, 'base64') };
  }
  if (USE_PG) {
    const r = await pool.query('SELECT mime, bytes FROM uploads WHERE id = $1', [theId]);
    return r.rows[0] ? { mime: r.rows[0].mime, bytes: r.rows[0].bytes } : null;
  }
  try {
    const bytes = fs.readFileSync(path.join(UPLOADS_DIR, theId));
    let mime = 'application/octet-stream';
    try { mime = fs.readFileSync(path.join(UPLOADS_DIR, theId + '.mime'), 'utf8'); } catch {}
    return { mime, bytes };
  } catch { return null; }
}

export const id = () => crypto.randomUUID();

function coll(name) { if (!state[name]) state[name] = []; return state[name]; }

export const db = {
  raw: () => state,
  all: (name) => coll(name),
  find: (name, pred) => coll(name).find(pred),
  filter: (name, pred) => coll(name).filter(pred),
  byId: (name, theId) => coll(name).find((x) => x.id === theId),
  insert: (name, doc) => { const row = { id: doc.id || id(), ...doc }; coll(name).push(row); persist(); return row; },
  update: (name, theId, patch) => { const row = coll(name).find((x) => x.id === theId); if (!row) return null; Object.assign(row, patch); persist(); return row; },
  remove: (name, pred) => { const arr = coll(name); const kept = arr.filter((x) => !pred(x)); const removed = arr.length - kept.length; state[name] = kept; persist(); return removed; },
  persist,
};

export default db;
