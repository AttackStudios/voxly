// Shared helpers: rank definitions + public serializers.
import db from './db.js';

// Global ranks — show in EVERY server with a badge/color.
export const GLOBAL_RANKS = {
  owner: { label: 'Owner', color: '#f1c40f', priority: 100 },
  staff: { label: 'Staff', color: '#e67e22', priority: 80 },
  alt: { label: 'ALT', color: '#00b8d4', priority: 60 },
};

// Per-server ranks — only apply/show inside one server.
export const SERVER_RANKS = {
  admin: { label: 'Admin', color: '#e74c3c', priority: 50 },
  mod: { label: 'Moderator', color: '#3498db', priority: 30 },
  member: { label: 'Member', color: '#95a5a6', priority: 10 },
};

export function globalRankMeta(rank) {
  return rank && GLOBAL_RANKS[rank] ? { key: rank, ...GLOBAL_RANKS[rank] } : null;
}
export function serverRankMeta(rank) {
  const r = rank && SERVER_RANKS[rank] ? rank : 'member';
  return { key: r, ...SERVER_RANKS[r] };
}

// strip secrets from a user record (no email — that's only for the user themself)
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    displayName: u.displayName,
    tag: u.tag,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl || null,
    globalRank: u.globalRank || null,
    globalRankMeta: globalRankMeta(u.globalRank),
    status: u.status || 'offline',
    bot: !!u.bot,
    official: !!u.official, // Voxly's own staff/announcement accounts
    // profile card
    bannerUrl: u.bannerUrl || null,
    bannerColor: u.bannerColor || null,
    aboutMe: u.aboutMe || '',
    pronouns: u.pronouns || '',
    customStatus: u.customStatus || '',
    createdAt: u.createdAt || null,
  };
}

// the signed-in user's own record (adds private fields)
export function selfUser(u) {
  if (!u) return null;
  return { ...publicUser(u), email: u.email };
}

// a user as they appear inside a specific server (adds server rank + nickname)
export function memberView(userId, serverId) {
  const u = db.byId('users', userId);
  if (!u) return null;
  const m = db.find('serverMembers', (x) => x.userId === userId && x.serverId === serverId);
  return {
    ...publicUser(u),
    serverRank: serverRankMeta(m?.serverRank),
    nickname: m?.nickname || null,
    joinedAt: m?.joinedAt || null,
  };
}

export function isOwnerOf(userId, serverId) {
  const s = db.byId('servers', serverId);
  return s && s.ownerId === userId;
}

// Can this user moderate the given server? (global owner/staff, server owner, admin/mod)
export function canModerate(userId, serverId) {
  const u = db.byId('users', userId);
  if (u && (u.globalRank === 'owner' || u.globalRank === 'staff')) return true;
  if (isOwnerOf(userId, serverId)) return true;
  const m = db.find('serverMembers', (x) => x.userId === userId && x.serverId === serverId);
  return m && (m.serverRank === 'admin' || m.serverRank === 'mod');
}

// Server settings (name/icon/bots): global owner/staff, server owner, or server admin.
export function canManageServer(userId, serverId) {
  const u = db.byId('users', userId);
  if (u && (u.globalRank === 'owner' || u.globalRank === 'staff')) return true;
  if (isOwnerOf(userId, serverId)) return true;
  const m = db.find('serverMembers', (x) => x.userId === userId && x.serverId === serverId);
  return !!m && m.serverRank === 'admin';
}
