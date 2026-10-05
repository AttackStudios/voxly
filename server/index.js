import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as IOServer } from 'socket.io';
import db, { id as newId, init as dbInit, saveUpload, getUpload, flush as dbFlush, USE_KV } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');
import { hashPassword, checkPassword, signToken, requireAuth, verifyToken } from './auth.js';
import {
  publicUser, memberView, serverRankMeta, canModerate, isOwnerOf,
  GLOBAL_RANKS, SERVER_RANKS,
} from './model.js';

const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));

// ---------- IMAGE UPLOAD (stored in the datastore: Postgres or local folder) ----------
const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
app.post('/api/upload', requireAuth, express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  const type = (req.headers['content-type'] || '').split(';')[0].trim();
  const ext = IMAGE_EXT[type];
  if (!ext) return res.status(400).json({ error: 'Only PNG, JPG, GIF, or WebP images are allowed' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'Empty upload' });
  // Upstash caps a single request size, so keep cloud images modest.
  if (USE_KV && req.body.length > 6 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 6 MB)' });
  const uid = `${newId()}.${ext}`;
  try { await saveUpload(uid, type, req.body); }
  catch (e) { return res.status(500).json({ error: 'Upload failed: ' + e.message }); }
  const name = (req.query.name ? String(req.query.name) : 'image').slice(0, 120);
  res.json({ url: `/uploads/${uid}`, name, type, size: req.body.length });
});
app.get('/uploads/:id', async (req, res) => {
  const u = await getUpload(req.params.id).catch(() => null);
  if (!u) return res.status(404).end();
  res.setHeader('Content-Type', u.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(u.bytes);
});

// ---------- helpers ----------
const randCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const randColor = () => {
  const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3498db', '#9b59b6', '#1abc9c'];
  return colors[Math.floor(Math.random() * colors.length)];
};
function nextTag(displayName) {
  // discord-style 4-digit discriminator, unique per displayName
  const taken = new Set(
    db.filter('users', (u) => u.displayName.toLowerCase() === displayName.toLowerCase()).map((u) => u.tag)
  );
  for (let i = 0; i < 9999; i++) {
    const t = String(Math.floor(1 + Math.random() * 9998)).padStart(4, '0');
    if (!taken.has(t)) return t;
  }
  return '0001';
}

// Find @mentioned users in a message. Matches @everyone/@here (all candidates)
// and @Name against each candidate's display name (case-insensitive, spaces
// removed so "@TheCoolLegoLord" matches "The Cool Lego Lord" too).
function parseMentions(content, candidates) {
  if (!content || !candidates?.length) return [];
  const out = new Set();
  if (/@(everyone|here)\b/i.test(content)) candidates.forEach((u) => out.add(u.id));
  const tokens = content.match(/@[\w.]+/g) || [];
  const norm = (s) => s.replace(/[\s.]+/g, '').toLowerCase();
  for (const tok of tokens) {
    const name = norm(tok.slice(1));
    for (const u of candidates) if (norm(u.displayName) === name) out.add(u.id);
  }
  return [...out];
}

function userServers(userId) {
  const memberships = db.filter('serverMembers', (m) => m.userId === userId);
  return memberships
    .map((m) => db.byId('servers', m.serverId))
    .filter(Boolean)
    .map((s) => ({ ...s, myRank: serverRankMeta(memberships.find((m) => m.serverId === s.id)?.serverRank) }));
}

function userDMs(userId) {
  return db
    .filter('dmConversations', (c) => c.participantIds.includes(userId))
    .map((c) => ({
      ...c,
      participants: c.participantIds.map((pid) => publicUser(db.byId('users', pid))).filter(Boolean),
    }));
}

// ---------- AUTH ----------
// Sign-up is off unless INVITE_CODE is set; then anyone with the code can make
// an account (the owner shares the code with friends instead of running the CLI).
const INVITE_CODE = (process.env.INVITE_CODE || '').trim();
app.get('/api/config', (_req, res) => res.json({ signup: !!INVITE_CODE }));

// ICE servers for WebRTC. STUN is free; TURN (relay for strict NATs) comes from
// env: TURN_URLS (comma-separated), TURN_USERNAME, TURN_CREDENTIAL.
app.get('/api/ice', (_req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  if (process.env.TURN_URLS) {
    ice.push({
      urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '',
    });
  }
  res.json({ iceServers: ice });
});

const signupTries = new Map(); // ip -> { n, t } — slow down invite-code guessing
app.post('/api/register', (req, res) => {
  if (!INVITE_CODE) return res.status(403).json({ error: 'Sign-up is disabled' });
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const now = Date.now(); const t = signupTries.get(ip) || { n: 0, t: now };
  if (now - t.t > 15 * 60e3) { t.n = 0; t.t = now; }
  if (++t.n > 10) return res.status(429).json({ error: 'Too many attempts, try again later' });
  signupTries.set(ip, t);

  const { email, password, displayName, code } = req.body || {};
  if (String(code || '').trim() !== INVITE_CODE) return res.status(403).json({ error: 'Wrong invite code' });
  const mail = String(email || '').trim().toLowerCase();
  const name = String(displayName || '').trim().slice(0, 32);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'Enter a valid email' });
  if (!name) return res.status(400).json({ error: 'Pick a display name' });
  if (String(password || '').length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.find('users', (u) => u.email.toLowerCase() === mail)) return res.status(409).json({ error: 'That email already has an account' });
  const tag = String(Math.floor(1 + Math.random() * 9998)).padStart(4, '0');
  const user = db.insert('users', {
    email: mail, passwordHash: hashPassword(password), displayName: name, tag,
    avatarColor: randColor(), globalRank: null, status: 'offline', createdAt: Date.now(),
  });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.find('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !checkPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const u = db.byId('users', req.userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: publicUser(u),
    servers: userServers(u.id),
    dms: userDMs(u.id),
  });
});

// Update own profile (display name / avatar color / avatar image / status)
app.patch('/api/me', requireAuth, (req, res) => {
  const { displayName, avatarColor, status, avatarUrl } = req.body || {};
  const patch = {};
  if (displayName) { patch.displayName = displayName; patch.tag = db.byId('users', req.userId).tag; }
  if (avatarColor) patch.avatarColor = avatarColor;
  if (status) patch.status = status;
  // avatarUrl: set to an uploaded image, or null to remove (back to color+initials)
  if (avatarUrl !== undefined) patch.avatarUrl = (avatarUrl && String(avatarUrl).startsWith('/uploads/')) ? avatarUrl : null;
  const u = db.update('users', req.userId, patch);
  res.json({ user: publicUser(u) });
});

// ---------- USERS (directory, for starting DMs) ----------
app.get('/api/users', requireAuth, (req, res) => {
  res.json({ users: db.all('users').map(publicUser) });
});

// ---------- SERVERS ----------
app.post('/api/servers', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Server name required' });
  const server = db.insert('servers', {
    name, ownerId: req.userId, iconColor: randColor(), inviteCode: randCode(), createdAt: Date.now(),
  });
  db.insert('serverMembers', { serverId: server.id, userId: req.userId, serverRank: 'admin', joinedAt: Date.now() });
  const general = db.insert('channels', { serverId: server.id, name: 'general', type: 'text', position: 0, createdAt: Date.now() });
  db.insert('channels', { serverId: server.id, name: 'General', type: 'voice', position: 1, createdAt: Date.now() });
  res.json({ server: { ...server, myRank: serverRankMeta('admin') }, firstChannelId: general.id });
});

app.get('/api/servers/:id', requireAuth, (req, res) => {
  const server = db.byId('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  const member = db.find('serverMembers', (m) => m.serverId === server.id && m.userId === req.userId);
  if (!member) return res.status(403).json({ error: 'Not a member' });
  const channels = db.filter('channels', (c) => c.serverId === server.id).sort((a, b) => a.position - b.position);
  const members = db
    .filter('serverMembers', (m) => m.serverId === server.id)
    .map((m) => memberView(m.userId, server.id))
    .filter(Boolean);
  // current voice occupants per channel so they show immediately on load
  const voice = {};
  channels.filter((c) => c.type === 'voice').forEach((c) => { voice[c.id] = voiceMembersOf(c.id); });
  res.json({ server, channels, members, voice, myRank: serverRankMeta(member.serverRank), isOwner: isOwnerOf(req.userId, server.id) });
});

app.post('/api/servers/join', requireAuth, (req, res) => {
  const { code } = req.body || {};
  const server = db.find('servers', (s) => s.inviteCode === String(code || '').toUpperCase());
  if (!server) return res.status(404).json({ error: 'Invalid invite code' });
  if (!db.find('serverMembers', (m) => m.serverId === server.id && m.userId === req.userId)) {
    db.insert('serverMembers', { serverId: server.id, userId: req.userId, serverRank: 'member', joinedAt: Date.now() });
  }
  emitToServer(server.id, 'server:member-joined', { serverId: server.id, member: memberView(req.userId, server.id) });
  res.json({ server: { ...server, myRank: serverRankMeta('member') } });
});

// Channels
app.post('/api/servers/:id/channels', requireAuth, (req, res) => {
  const server = db.byId('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (!canModerate(req.userId, server.id)) return res.status(403).json({ error: 'No permission' });
  const { name, type } = req.body || {};
  const position = db.filter('channels', (c) => c.serverId === server.id).length;
  const channel = db.insert('channels', {
    serverId: server.id, name: name || 'new-channel', type: type === 'voice' ? 'voice' : 'text', position, createdAt: Date.now(),
  });
  emitToServer(server.id, 'channel:created', { channel });
  res.json({ channel });
});

// Manage server-scoped ranks (owner/staff/server-owner/admin only)
app.post('/api/servers/:id/rank', requireAuth, (req, res) => {
  const server = db.byId('servers', req.params.id);
  if (!server) return res.status(404).json({ error: 'Server not found' });
  if (!canModerate(req.userId, server.id)) return res.status(403).json({ error: 'No permission' });
  const { userId, rank } = req.body || {};
  if (!SERVER_RANKS[rank]) return res.status(400).json({ error: 'Unknown rank' });
  const m = db.find('serverMembers', (x) => x.serverId === server.id && x.userId === userId);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  db.update('serverMembers', m.id, { serverRank: rank });
  emitToServer(server.id, 'server:member-updated', { serverId: server.id, member: memberView(userId, server.id) });
  res.json({ member: memberView(userId, server.id) });
});

// ---------- DMs & GROUP CHATS ----------
app.post('/api/dms', requireAuth, (req, res) => {
  let { participantIds, name } = req.body || {};
  participantIds = Array.from(new Set([...(participantIds || []), req.userId]));
  const isGroup = participantIds.length > 2;
  if (!isGroup) {
    // reuse existing 1:1 conversation if present
    const existing = db.find('dmConversations', (c) =>
      !c.isGroup && c.participantIds.length === 2 && participantIds.every((p) => c.participantIds.includes(p)));
    if (existing) return res.json({ conversation: withParticipants(existing) });
  }
  const convo = db.insert('dmConversations', {
    isGroup, name: isGroup ? (name || 'Group Chat') : null, ownerId: req.userId, participantIds, createdAt: Date.now(),
  });
  participantIds.forEach((pid) => io.to(`user:${pid}`).emit('dm:created', { conversation: withParticipants(convo) }));
  res.json({ conversation: withParticipants(convo) });
});

app.get('/api/dms', requireAuth, (req, res) => {
  res.json({ conversations: userDMs(req.userId) });
});

function withParticipants(c) {
  return { ...c, participants: c.participantIds.map((pid) => publicUser(db.byId('users', pid))).filter(Boolean) };
}

// Add member to a group DM
app.post('/api/dms/:id/add', requireAuth, (req, res) => {
  const convo = db.byId('dmConversations', req.params.id);
  if (!convo || !convo.participantIds.includes(req.userId)) return res.status(403).json({ error: 'No access' });
  const { userId } = req.body || {};
  if (!convo.participantIds.includes(userId)) {
    convo.participantIds.push(userId);
    convo.isGroup = convo.participantIds.length > 2;
    db.persist();
    convo.participantIds.forEach((pid) => io.to(`user:${pid}`).emit('dm:updated', { conversation: withParticipants(convo) }));
  }
  res.json({ conversation: withParticipants(convo) });
});

// ---------- MESSAGES (history) ----------
app.get('/api/channels/:id/messages', requireAuth, (req, res) => {
  const channel = db.byId('channels', req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (!db.find('serverMembers', (m) => m.serverId === channel.serverId && m.userId === req.userId))
    return res.status(403).json({ error: 'Not a member' });
  res.json({ messages: hydrateMessages(db.filter('messages', (m) => m.channelId === channel.id)) });
});

app.get('/api/dms/:id/messages', requireAuth, (req, res) => {
  const convo = db.byId('dmConversations', req.params.id);
  if (!convo || !convo.participantIds.includes(req.userId)) return res.status(403).json({ error: 'No access' });
  res.json({ messages: hydrateMessages(db.filter('messages', (m) => m.dmId === convo.id)) });
});

function hydrateMessages(list) {
  return list
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => ({ ...m, author: publicUser(db.byId('users', m.authorId)) }));
}

// expose rank metadata to the client
app.get('/api/ranks', (_req, res) => res.json({ global: GLOBAL_RANKS, server: SERVER_RANKS }));

app.get('/api/health', (_req, res) => res.json({ ok: true, users: db.all('users').length }));

// Serve the built web UI so a single public origin handles UI + API + realtime
// (used for the Cloudflare tunnel / public hosting). SPA fallback to index.html,
// but never for /api, /uploads, or /socket.io.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/(?:api|uploads|socket\.io)).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

// ================= SOCKET.IO =================
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e7 });

function emitToServer(serverId, event, payload) {
  db.filter('serverMembers', (m) => m.serverId === serverId).forEach((m) =>
    io.to(`user:${m.userId}`).emit(event, payload));
}

// who is currently in each voice channel (channelId -> Set(userId))
const voiceMembers = new Map();
const voiceAdd = (channelId, uid) => {
  if (!voiceMembers.has(channelId)) voiceMembers.set(channelId, new Set());
  voiceMembers.get(channelId).add(uid);
};
const voiceRemove = (channelId, uid) => { voiceMembers.get(channelId)?.delete(uid); };
export const voiceMembersOf = (channelId) => [...(voiceMembers.get(channelId) || [])];

// socket auth via handshake token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const payload = token && verifyToken(token);
  if (!payload) return next(new Error('unauthorized'));
  socket.userId = payload.uid;
  next();
});

const onlineCounts = new Map(); // userId -> open socket count

io.on('connection', (socket) => {
  const uid = socket.userId;
  socket.join(`user:${uid}`);
  // join rooms for all my channels + DMs
  userServers(uid).forEach((s) =>
    db.filter('channels', (c) => c.serverId === s.id).forEach((c) => socket.join(`channel:${c.id}`)));
  db.filter('dmConversations', (c) => c.participantIds.includes(uid)).forEach((c) => socket.join(`dm:${c.id}`));

  // presence
  onlineCounts.set(uid, (onlineCounts.get(uid) || 0) + 1);
  if (onlineCounts.get(uid) === 1) {
    db.update('users', uid, { status: 'online' });
    io.emit('presence:update', { userId: uid, status: 'online' });
  }

  // ---- send a message (text channel or DM) ----
  socket.on('message:send', (data, ack) => {
    const { channelId, dmId, content } = data || {};
    // keep only valid image attachments served from our own /uploads
    const attachments = Array.isArray(data?.attachments)
      ? data.attachments
          .filter((a) => a && typeof a.url === 'string' && a.url.startsWith('/uploads/'))
          .slice(0, 10)
          .map((a) => ({ url: a.url, name: String(a.name || 'image').slice(0, 120), type: a.type || '', size: a.size || 0 }))
      : [];
    if ((!content || !content.trim()) && attachments.length === 0) return;
    let room, target, candidates;
    if (channelId) {
      const ch = db.byId('channels', channelId);
      if (!ch || !db.find('serverMembers', (m) => m.serverId === ch.serverId && m.userId === uid)) return;
      room = `channel:${channelId}`; target = { channelId, serverId: ch.serverId };
      candidates = db.filter('serverMembers', (m) => m.serverId === ch.serverId).map((m) => db.byId('users', m.userId)).filter(Boolean);
    } else if (dmId) {
      const c = db.byId('dmConversations', dmId);
      if (!c || !c.participantIds.includes(uid)) return;
      room = `dm:${dmId}`; target = { dmId };
      candidates = c.participantIds.map((p) => db.byId('users', p)).filter(Boolean);
    } else return;

    const mentions = parseMentions(content || '', candidates); // [userId]
    const msg = db.insert('messages', {
      ...target, authorId: uid, content: (content || '').slice(0, 4000), attachments, mentions, createdAt: Date.now(),
    });
    const full = { ...msg, author: publicUser(db.byId('users', uid)) };
    io.to(room).emit('message:new', full);
    const from = publicUser(db.byId('users', uid));
    const preview = msg.content || (attachments.length ? `📷 ${attachments.length > 1 ? attachments.length + ' images' : 'Image'}` : '');

    const sendNotify = (toId, extra) =>
      io.to(`user:${toId}`).emit('notify', { from, content: preview, mention: mentions.includes(toId), ...extra });

    if (dmId) {
      // DMs always notify the other participants
      candidates.filter((u) => u.id !== uid).forEach((u) => sendNotify(u.id, { kind: 'dm', dmId }));
    } else if (channelId) {
      // channels ping ONLY the people who were @mentioned (keeps it from being noisy)
      const ch = db.byId('channels', channelId);
      mentions.filter((p) => p !== uid).forEach((p) =>
        sendNotify(p, { kind: 'channel', channelId, serverId: ch.serverId, channelName: ch.name }));
    }
    ack && ack({ ok: true, message: full });
  });

  const roomOf = (msg) => (msg.channelId ? `channel:${msg.channelId}` : `dm:${msg.dmId}`);

  // ---- edit a message (author only) ----
  socket.on('message:edit', ({ messageId, content }) => {
    const msg = db.byId('messages', messageId);
    if (!msg || msg.authorId !== uid) return;
    if (!content || !content.trim()) return; // to clear text, delete instead
    db.update('messages', messageId, { content: content.slice(0, 4000), editedAt: Date.now() });
    const full = { ...db.byId('messages', messageId), author: publicUser(db.byId('users', uid)) };
    io.to(roomOf(msg)).emit('message:updated', full);
  });

  // ---- delete a message (author, or a server mod/owner for channel messages) ----
  socket.on('message:delete', ({ messageId }) => {
    const msg = db.byId('messages', messageId);
    if (!msg) return;
    const isAuthor = msg.authorId === uid;
    const canMod = msg.channelId ? canModerate(uid, db.byId('channels', msg.channelId)?.serverId) : false;
    if (!isAuthor && !canMod) return;
    const room = roomOf(msg);
    db.remove('messages', (m) => m.id === messageId);
    io.to(room).emit('message:deleted', { id: messageId, channelId: msg.channelId || null, dmId: msg.dmId || null });
  });

  // typing indicator
  socket.on('typing', ({ channelId, dmId }) => {
    const room = channelId ? `channel:${channelId}` : dmId ? `dm:${dmId}` : null;
    if (room) socket.to(room).emit('typing', { userId: uid, channelId, dmId });
  });

  // join a room dynamically (e.g. after creating/joining a server)
  socket.on('room:join', ({ channelId, dmId, serverId }) => {
    if (channelId) socket.join(`channel:${channelId}`);
    if (dmId) socket.join(`dm:${dmId}`);
    if (serverId) db.filter('channels', (c) => c.serverId === serverId).forEach((c) => socket.join(`channel:${c.id}`));
  });

  // ============ WEBRTC SIGNALING (voice / video / screen share) ============
  // Generic targeted relay between two users. `to` is a userId.
  const relay = (event) => (data) => {
    if (data?.to) io.to(`user:${data.to}`).emit(event, { ...data, from: uid });
  };
  socket.on('rtc:offer', relay('rtc:offer'));
  socket.on('rtc:answer', relay('rtc:answer'));
  socket.on('rtc:ice', relay('rtc:ice'));

  // Call lifecycle (DM / group voice or video)
  socket.on('call:invite', ({ to, dmId, video }) => {
    io.to(`user:${to}`).emit('call:incoming', { from: publicUser(db.byId('users', uid)), dmId, video, fromId: uid });
  });
  socket.on('call:accept', ({ to, dmId }) => io.to(`user:${to}`).emit('call:accepted', { dmId, fromId: uid }));
  socket.on('call:decline', ({ to, dmId }) => io.to(`user:${to}`).emit('call:declined', { dmId, fromId: uid }));
  socket.on('call:end', ({ to, dmId }) => io.to(`user:${to}`).emit('call:ended', { dmId, fromId: uid }));

  // Voice-channel presence (mesh): announce join/leave to channel
  socket.on('voice:join', ({ channelId }) => {
    socket.join(`voice:${channelId}`);
    // existing members BEFORE adding the newcomer (these are who the newcomer dials)
    const peers = voiceMembersOf(channelId).filter((u) => u !== uid);
    voiceAdd(channelId, uid);
    socket.to(`voice:${channelId}`).emit('voice:peer-joined', { userId: uid, channelId });
    socket.emit('voice:peers', { channelId, peers });
    io.emit('voice:state', { channelId, userId: uid, joined: true });
  });
  socket.on('voice:leave', ({ channelId }) => {
    socket.leave(`voice:${channelId}`);
    voiceRemove(channelId, uid);
    socket.to(`voice:${channelId}`).emit('voice:peer-left', { userId: uid, channelId });
    io.emit('voice:state', { channelId, userId: uid, joined: false });
  });

  // 'disconnecting' fires while socket.rooms is still populated — use it to drop
  // the user from any voice channels this socket was in (prevents ghost members).
  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (typeof room === 'string' && room.startsWith('voice:')) {
        const channelId = room.slice('voice:'.length);
        voiceRemove(channelId, uid);
        io.emit('voice:state', { channelId, userId: uid, joined: false });
      }
    }
  });

  socket.on('disconnect', () => {
    onlineCounts.set(uid, (onlineCounts.get(uid) || 1) - 1);
    if ((onlineCounts.get(uid) || 0) <= 0) {
      onlineCounts.delete(uid);
      db.update('users', uid, { status: 'offline' });
      io.emit('presence:update', { userId: uid, status: 'offline' });
    }
  });
});

// Boot: load the datastore (Postgres or file), seed a first-run owner if empty,
// then start listening.
(async () => {
  await dbInit();

  // No one is connected at boot, so clear any stale 'online' status left over from
  // a previous run that was killed before it could mark users offline.
  db.all('users').forEach((u) => { if (u.status !== 'offline') db.update('users', u.id, { status: 'offline' }); });

  // First-run owner seed (packaged desktop app / cloud first deploy — no CLI).
  // Format: DC_SEED_OWNER="email::password::Display Name". Only seeds an empty DB.
  if (process.env.DC_SEED_OWNER && db.all('users').length === 0) {
    const [email, password, displayName] = process.env.DC_SEED_OWNER.split('::');
    if (email && password) {
      const tag = String(Math.floor(1 + Math.random() * 9998)).padStart(4, '0');
      db.insert('users', {
        email, passwordHash: hashPassword(password), displayName: displayName || 'Owner',
        tag, avatarColor: randColor(), globalRank: 'owner', status: 'offline', createdAt: Date.now(),
      });
      console.log(`     ✓ Seeded owner account: ${email}`);
    }
  }

  // Render stops the instance with SIGTERM (sleep/redeploy) — save pending writes first.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => { try { await dbFlush(); } catch (e) { console.error('[db] flush failed', e.message); } process.exit(0); });
  }

  server.listen(PORT, () => {
    console.log(`\n  🔊 Voxly server running on port ${PORT}`);
    console.log(`     Storage: ${process.env.DATABASE_URL ? 'Postgres' : USE_KV ? 'Upstash' : 'local file'} · Users: ${db.all('users').length}`);
    if (db.all('users').length === 0) {
      console.log(`     ⚠  No accounts yet. Create one:  npm run admin -- create-user <email> <password> "<Display Name>" [owner|staff]\n`);
    }
  });
})();
