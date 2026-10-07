// Platform features layered on the core chat server:
//  • server settings (name / icon / colour / delete) and adding bots to servers
//  • profiles (Discord-style profile card data)
//  • bot accounts (Developer portal) + the Bot REST API under /api/v1
// Bots authenticate with "Authorization: Bot <token>" (REST) or
// io(url, { auth: { botToken } }) (realtime). See BOTS.md.
import db from './db.js';
import { requireAuth, requireHuman, newBotToken } from './auth.js';
import { publicUser, memberView, serverRankMeta, canManageServer, isOwnerOf } from './model.js';

const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) && u.length <= 2048;
const imgUrl = (u) => (isHttpUrl(u) || (typeof u === 'string' && u.startsWith('/uploads/')) ? u : null);
const str = (v, n) => (v === undefined || v === null ? undefined : String(v).slice(0, n));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// Discord-shaped embeds, trimmed to sane limits. Accepts color as int or "#rrggbb".
export function sanitizeEmbeds(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).map((e) => {
    if (!e || typeof e !== 'object') return null;
    let color = e.color;
    if (typeof color === 'string' && /^#?[0-9a-f]{6}$/i.test(color)) color = parseInt(color.replace('#', ''), 16);
    const out = clean({
      title: str(e.title, 256),
      description: str(e.description, 4096),
      url: isHttpUrl(e.url) ? e.url : undefined,
      color: Number.isInteger(color) && color >= 0 && color <= 0xffffff ? color : undefined,
      image: imgUrl(e.image?.url) ? { url: imgUrl(e.image.url) } : undefined,
      thumbnail: imgUrl(e.thumbnail?.url) ? { url: imgUrl(e.thumbnail.url) } : undefined,
      footer: e.footer?.text ? clean({ text: str(e.footer.text, 2048), icon_url: imgUrl(e.footer.icon_url) || undefined }) : undefined,
      author: e.author?.name ? clean({ name: str(e.author.name, 256), icon_url: imgUrl(e.author.icon_url) || undefined }) : undefined,
      fields: Array.isArray(e.fields) && e.fields.length
        ? e.fields.slice(0, 25).filter((f) => f && f.name !== undefined && f.value !== undefined)
          .map((f) => ({ name: str(f.name, 256), value: str(f.value, 1024), inline: !!f.inline }))
        : undefined,
      timestamp: typeof e.timestamp === 'string' || typeof e.timestamp === 'number' ? e.timestamp : undefined,
    });
    return Object.keys(out).length ? out : null;
  }).filter(Boolean);
}

const isMember = (uid, serverId) => !!db.find('serverMembers', (m) => m.serverId === serverId && m.userId === uid);
const serverView = (s) => ({
  id: s.id, name: s.name, ownerId: s.ownerId, iconColor: s.iconColor, iconUrl: s.iconUrl || null,
  description: s.description || '', createdAt: s.createdAt,
});
const botView = (u, withOwner) => ({
  ...publicUser(u), ownerId: u.ownerId, description: u.botDescription || '',
  servers: withOwner ? db.filter('serverMembers', (m) => m.userId === u.id).length : undefined,
});

export function mountPlatform(app, ctx) {
  const { io, postMessage, editMessage, deleteMessage, canDeleteMessage, emitToServer, userServers, withParticipants, randColor } = ctx;
  const fail = (res, r) => res.status(r.status || 400).json({ error: r.error });

  // ================= SERVER SETTINGS =================
  app.patch('/api/servers/:id', requireAuth, requireHuman, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!canManageServer(req.userId, s.id)) return res.status(403).json({ error: 'Only the owner or admins can change server settings' });
    const { name, iconColor, iconUrl, description } = req.body || {};
    const patch = {};
    if (name !== undefined) {
      const n = String(name).trim().slice(0, 50);
      if (!n) return res.status(400).json({ error: 'Server name can’t be empty' });
      patch.name = n;
    }
    if (iconColor !== undefined && /^#[0-9a-f]{6}$/i.test(String(iconColor))) patch.iconColor = iconColor;
    if (iconUrl !== undefined) patch.iconUrl = iconUrl && String(iconUrl).startsWith('/uploads/') ? iconUrl : null;
    if (description !== undefined) patch.description = String(description || '').slice(0, 300);
    const updated = db.update('servers', s.id, patch);
    emitToServer(s.id, 'server:updated', { server: updated });
    res.json({ server: updated });
  });

  app.post('/api/servers/:id/invite', requireAuth, requireHuman, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!canManageServer(req.userId, s.id)) return res.status(403).json({ error: 'No permission' });
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const updated = db.update('servers', s.id, { inviteCode: code });
    emitToServer(s.id, 'server:updated', { server: updated });
    res.json({ server: updated });
  });

  app.delete('/api/servers/:id', requireAuth, requireHuman, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!isOwnerOf(req.userId, s.id) && db.byId('users', req.userId)?.globalRank !== 'owner')
      return res.status(403).json({ error: 'Only the server owner can delete it' });
    emitToServer(s.id, 'server:deleted', { serverId: s.id });
    const chanIds = new Set(db.filter('channels', (c) => c.serverId === s.id).map((c) => c.id));
    db.remove('messages', (m) => chanIds.has(m.channelId));
    db.remove('channels', (c) => c.serverId === s.id);
    db.remove('serverMembers', (m) => m.serverId === s.id);
    db.remove('servers', (x) => x.id === s.id);
    res.json({ ok: true });
  });

  // remove a member (bots by managers; anyone by mods is handled elsewhere)
  app.delete('/api/servers/:id/members/:userId', requireAuth, requireHuman, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    const target = db.byId('users', req.params.userId);
    const self = req.params.userId === req.userId;
    if (!self && !canManageServer(req.userId, s.id)) return res.status(403).json({ error: 'No permission' });
    if (target?.id === s.ownerId) return res.status(400).json({ error: 'The owner can’t be removed' });
    db.remove('serverMembers', (m) => m.serverId === s.id && m.userId === req.params.userId);
    db.filter('channels', (c) => c.serverId === s.id).forEach((c) => io.in(`user:${req.params.userId}`).socketsLeave(`channel:${c.id}`));
    emitToServer(s.id, 'server:member-left', { serverId: s.id, userId: req.params.userId });
    io.to(`user:${req.params.userId}`).emit('server:removed', { serverId: s.id });
    res.json({ ok: true });
  });

  // add a bot (by its ID) to a server
  app.post('/api/servers/:id/bots', requireAuth, requireHuman, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!canManageServer(req.userId, s.id)) return res.status(403).json({ error: 'Only the owner or admins can add bots' });
    const bot = db.byId('users', String(req.body?.botId || '').trim());
    if (!bot || !bot.bot) return res.status(404).json({ error: 'No bot with that ID' });
    if (!isMember(bot.id, s.id)) {
      db.insert('serverMembers', { serverId: s.id, userId: bot.id, serverRank: 'member', joinedAt: Date.now() });
      db.filter('channels', (c) => c.serverId === s.id).forEach((c) => io.in(`user:${bot.id}`).socketsJoin(`channel:${c.id}`));
      emitToServer(s.id, 'server:member-joined', { serverId: s.id, member: memberView(bot.id, s.id) });
      io.to(`user:${bot.id}`).emit('server:joined', { server: serverView(s) });
    }
    res.json({ member: memberView(bot.id, s.id) });
  });

  // ================= SHORT-LINK RESOLVER (TikTok share links) =================
  // Only follows redirects for known short-link hosts, and only returns the
  // final URL — never page content. Results are cached.
  const SHORT_HOSTS = /^https:\/\/(?:vm\.tiktok\.com|vt\.tiktok\.com|(?:www\.)?tiktok\.com\/t)\/[A-Za-z0-9]+\/?$/i;
  const resolved = new Map();
  app.get('/api/resolve-link', requireAuth, async (req, res) => {
    const url = String(req.query.url || '').trim();
    if (!SHORT_HOSTS.test(url)) return res.status(400).json({ error: 'Unsupported link' });
    if (resolved.has(url)) return res.json({ url: resolved.get(url) });
    try {
      let cur = url;
      for (let hop = 0; hop < 4; hop++) {
        const r = await fetch(cur, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VoxlyBot/1.0)' }, signal: AbortSignal.timeout(6000) });
        const loc = r.headers.get('location');
        if (!loc || r.status < 300 || r.status >= 400) break;
        cur = new URL(loc, cur).toString();
        if (/tiktok\.com\/@[\w.-]*\/video\/\d+/.test(cur)) break;
      }
      const final = /^https:\/\/(?:www\.|m\.)?tiktok\.com\//.test(cur) ? cur.split('?')[0] : null;
      if (resolved.size > 2000) resolved.clear();
      resolved.set(url, final);
      res.json({ url: final });
    } catch { res.json({ url: null }); }
  });

  // ================= ADMIN (global owner only) =================
  const requireOwner = (req, res, next) =>
    (db.byId('users', req.userId)?.globalRank === 'owner' ? next() : res.status(403).json({ error: 'Owner only' }));
  app.get('/api/admin/users', requireAuth, requireHuman, requireOwner, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const list = db.all('users')
      .filter((u) => !q || u.displayName.toLowerCase().includes(q) || `${u.displayName}#${u.tag}`.toLowerCase().includes(q))
      .slice(0, 50)
      .map((u) => ({ ...publicUser(u), email: u.bot ? null : u.email }));
    res.json({ users: list });
  });
  app.patch('/api/admin/users/:id', requireAuth, requireHuman, requireOwner, (req, res) => {
    const u = db.byId('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const { tag, official } = req.body || {};
    const patch = {};
    if (tag !== undefined) {
      if (!/^\d{4}$/.test(String(tag))) return res.status(400).json({ error: 'Tag must be 4 digits' });
      const clash = db.find('users', (x) => x.id !== u.id && x.tag === String(tag) && x.displayName.toLowerCase() === u.displayName.toLowerCase());
      if (clash) return res.status(409).json({ error: `Someone else is already ${u.displayName}#${tag}` });
      patch.tag = String(tag);
    }
    if (official !== undefined) patch.official = !!official;
    const updated = db.update('users', u.id, patch);
    io.emit('user:updated', { user: publicUser(updated) });
    res.json({ user: { ...publicUser(updated), email: updated.bot ? null : updated.email } });
  });

  // ================= PROFILES =================
  app.get('/api/users/:id/profile', requireAuth, (req, res) => {
    const u = db.byId('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const serverId = req.query.serverId;
    const mine = new Set(db.filter('serverMembers', (m) => m.userId === req.userId).map((m) => m.serverId));
    const mutualServers = db.filter('serverMembers', (m) => m.userId === u.id && mine.has(m.serverId) && u.id !== req.userId)
      .map((m) => db.byId('servers', m.serverId)).filter(Boolean).map(serverView);
    const member = serverId && isMember(u.id, serverId) && isMember(req.userId, serverId) ? memberView(u.id, serverId) : null;
    res.json({
      user: publicUser(u),
      member: member ? { serverRank: member.serverRank, nickname: member.nickname, joinedAt: member.joinedAt, isOwner: isOwnerOf(u.id, serverId) } : null,
      mutualServers,
      bot: u.bot ? { description: u.botDescription || '', owner: publicUser(db.byId('users', u.ownerId)) } : null,
    });
  });

  // ================= DEVELOPER PORTAL (bot accounts) =================
  const ownBot = (req, res) => {
    const b = db.byId('users', req.params.id);
    if (!b || !b.bot || b.ownerId !== req.userId) { res.status(404).json({ error: 'Bot not found' }); return null; }
    return b;
  };
  app.get('/api/bots', requireAuth, requireHuman, (req, res) => {
    res.json({ bots: db.filter('users', (u) => u.bot && u.ownerId === req.userId).map((b) => botView(b, true)) });
  });
  app.post('/api/bots', requireAuth, requireHuman, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 32);
    if (!name) return res.status(400).json({ error: 'Give your bot a name' });
    if (db.filter('users', (u) => u.bot && u.ownerId === req.userId).length >= 10) return res.status(400).json({ error: 'Max 10 bots per account' });
    const bot = db.insert('users', {
      bot: true, ownerId: req.userId, email: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}@bots.voxly`,
      passwordHash: null, displayName: name, tag: '0000', avatarColor: randColor(), globalRank: null,
      status: 'offline', botDescription: String(req.body?.description || '').slice(0, 400), createdAt: Date.now(),
    });
    const { token, hash } = newBotToken(bot.id);
    db.update('users', bot.id, { botTokenHash: hash });
    res.json({ bot: botView(db.byId('users', bot.id), true), token });
  });
  app.patch('/api/bots/:id', requireAuth, requireHuman, (req, res) => {
    const b = ownBot(req, res); if (!b) return;
    const { name, avatarUrl, description, avatarColor } = req.body || {};
    const patch = {};
    if (name) patch.displayName = String(name).trim().slice(0, 32);
    if (description !== undefined) patch.botDescription = String(description || '').slice(0, 400);
    if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl && String(avatarUrl).startsWith('/uploads/') ? avatarUrl : null;
    if (avatarColor && /^#[0-9a-f]{6}$/i.test(avatarColor)) patch.avatarColor = avatarColor;
    const u = db.update('users', b.id, patch);
    io.emit('user:updated', { user: publicUser(u) });
    res.json({ bot: botView(u, true) });
  });
  app.post('/api/bots/:id/token', requireAuth, requireHuman, (req, res) => {
    const b = ownBot(req, res); if (!b) return;
    const { token, hash } = newBotToken(b.id);
    db.update('users', b.id, { botTokenHash: hash });
    io.in(`user:${b.id}`).disconnectSockets(true); // old token stops working immediately
    res.json({ token });
  });
  app.delete('/api/bots/:id', requireAuth, requireHuman, (req, res) => {
    const b = ownBot(req, res); if (!b) return;
    io.in(`user:${b.id}`).disconnectSockets(true);
    db.filter('serverMembers', (m) => m.userId === b.id).forEach((m) =>
      emitToServer(m.serverId, 'server:member-left', { serverId: m.serverId, userId: b.id }));
    db.remove('serverMembers', (m) => m.userId === b.id);
    db.remove('users', (u) => u.id === b.id);
    res.json({ ok: true });
  });

  // ================= BOT REST API (/api/v1) — works with bot or user tokens =================
  const v1 = '/api/v1';
  app.get(`${v1}/users/@me`, requireAuth, (req, res) => res.json(publicUser(db.byId('users', req.userId))));
  app.get(`${v1}/users/:id`, requireAuth, (req, res) => {
    const u = db.byId('users', req.params.id);
    return u ? res.json(publicUser(u)) : res.status(404).json({ error: 'User not found' });
  });
  app.get(`${v1}/servers`, requireAuth, (req, res) => res.json(userServers(req.userId).map(serverView)));
  app.get(`${v1}/servers/:id`, requireAuth, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!isMember(req.userId, s.id)) return res.status(403).json({ error: 'Not a member' });
    res.json({
      ...serverView(s),
      channels: db.filter('channels', (c) => c.serverId === s.id).sort((a, b) => a.position - b.position)
        .map((c) => ({ id: c.id, name: c.name, type: c.type, serverId: c.serverId })),
    });
  });
  app.get(`${v1}/servers/:id/members`, requireAuth, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s) return res.status(404).json({ error: 'Server not found' });
    if (!isMember(req.userId, s.id)) return res.status(403).json({ error: 'Not a member' });
    res.json(db.filter('serverMembers', (m) => m.serverId === s.id).map((m) => ({ ...memberView(m.userId, s.id), isOwner: m.userId === s.ownerId })));
  });
  app.get(`${v1}/servers/:id/members/:userId`, requireAuth, (req, res) => {
    const s = db.byId('servers', req.params.id);
    if (!s || !isMember(req.userId, s.id)) return res.status(404).json({ error: 'Server not found' });
    if (!isMember(req.params.userId, s.id)) return res.status(404).json({ error: 'Member not found' });
    const mv = memberView(req.params.userId, s.id);
    res.json({ ...mv, isOwner: req.params.userId === s.ownerId, canManage: canManageServer(req.params.userId, s.id) });
  });
  app.get(`${v1}/channels/:id`, requireAuth, (req, res) => {
    const c = db.byId('channels', req.params.id);
    if (c && isMember(req.userId, c.serverId)) return res.json({ id: c.id, name: c.name, type: c.type, serverId: c.serverId });
    const dm = db.byId('dmConversations', req.params.id);
    if (dm && dm.participantIds.includes(req.userId)) return res.json({ id: dm.id, type: 'dm', serverId: null, participantIds: dm.participantIds });
    res.status(404).json({ error: 'Channel not found' });
  });
  // channelId may be a server channel OR a DM conversation id
  const target = (id) => (db.byId('dmConversations', id) ? { dmId: id } : { channelId: id });
  app.get(`${v1}/channels/:id/messages`, requireAuth, (req, res) => {
    const t = target(req.params.id);
    if (t.channelId) {
      const c = db.byId('channels', t.channelId);
      if (!c || !isMember(req.userId, c.serverId)) return res.status(404).json({ error: 'Channel not found' });
    } else if (!db.byId('dmConversations', t.dmId).participantIds.includes(req.userId)) return res.status(404).json({ error: 'Channel not found' });
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const list = db.filter('messages', (m) => (t.channelId ? m.channelId === t.channelId : m.dmId === t.dmId))
      .sort((a, b) => a.createdAt - b.createdAt).slice(-limit).map(ctx.fullMessage);
    res.json(list);
  });
  app.post(`${v1}/channels/:id/messages`, requireAuth, (req, res) => {
    const b = req.body || {};
    const r = postMessage(req.userId, { ...target(req.params.id), content: b.content, embeds: b.embeds, attachments: b.attachments, replyToId: b.replyToId });
    return r.error ? fail(res, r) : res.json(r.message);
  });
  app.patch(`${v1}/messages/:id`, requireAuth, (req, res) => {
    const m = db.byId('messages', req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (m.authorId !== req.userId) return res.status(403).json({ error: 'You can only edit your own messages' });
    res.json(editMessage(m, { content: req.body?.content, embeds: req.body?.embeds }));
  });
  app.delete(`${v1}/messages/:id`, requireAuth, (req, res) => {
    const m = db.byId('messages', req.params.id);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (!canDeleteMessage(req.userId, m)) return res.status(403).json({ error: 'No permission' });
    deleteMessage(m);
    res.json({ ok: true });
  });
  // open (or reuse) a 1:1 DM with a user — bots can only DM people they share a server with
  app.post(`${v1}/dms`, requireAuth, (req, res) => {
    const other = db.byId('users', String(req.body?.userId || ''));
    if (!other || other.id === req.userId) return res.status(404).json({ error: 'User not found' });
    if (req.isBot) {
      const mine = new Set(db.filter('serverMembers', (m) => m.userId === req.userId).map((m) => m.serverId));
      if (!db.find('serverMembers', (m) => m.userId === other.id && mine.has(m.serverId))) return res.status(403).json({ error: 'No shared server with that user' });
    }
    let convo = db.find('dmConversations', (c) => !c.isGroup && c.participantIds.length === 2 && c.participantIds.includes(req.userId) && c.participantIds.includes(other.id));
    if (!convo) {
      convo = db.insert('dmConversations', { participantIds: [req.userId, other.id], isGroup: false, name: null, createdAt: Date.now() });
      [req.userId, other.id].forEach((pid) => {
        io.in(`user:${pid}`).socketsJoin(`dm:${convo.id}`);
        io.to(`user:${pid}`).emit('dm:created', { conversation: withParticipants(convo) });
      });
    }
    res.json({ id: convo.id, type: 'dm', participantIds: convo.participantIds });
  });
}
