import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import db, { DATA_DIR } from './db.js';

const SECRET_FILE = path.join(DATA_DIR, '.jwtsecret');

// Prefer an env secret (so tokens survive restarts on hosts with ephemeral disks,
// e.g. Render); otherwise persist a random one to a local file for dev/desktop.
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(48).toString('hex');
    try { fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true }); fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); } catch {}
    return s;
  }
}
const SECRET = getSecret();

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export const signToken = (user) =>
  jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: '30d' });

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

// ---- bot tokens: "<botUserId>.<secret>"; only a SHA-256 of the secret is stored ----
export const hashSecret = (s) => crypto.createHash('sha256').update(s).digest('hex');
export function newBotToken(botId) {
  const secret = crypto.randomBytes(32).toString('base64url');
  return { token: `${botId}.${secret}`, hash: hashSecret(secret) };
}
export function botFromToken(token) {
  const dot = String(token || '').indexOf('.');
  if (dot < 1) return null;
  const u = db.byId('users', token.slice(0, dot));
  if (!u || !u.bot || !u.botTokenHash) return null;
  const a = Buffer.from(hashSecret(token.slice(dot + 1))), b = Buffer.from(u.botTokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? u : null;
}

// Express middleware: "Bearer <user JWT>" or "Bot <bot token>"; attaches req.userId.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bot ')) {
    const bot = botFromToken(header.slice(4).trim());
    if (!bot) return res.status(401).json({ error: 'Invalid bot token' });
    req.userId = bot.id; req.isBot = true;
    return next();
  }
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });
  if (db.byId('users', payload.uid)?.bot) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = payload.uid;
  next();
}
// human accounts only (bot management, uploads of profile art, etc.)
export function requireHuman(req, res, next) {
  if (req.isBot) return res.status(403).json({ error: 'Bots cannot do that' });
  next();
}
