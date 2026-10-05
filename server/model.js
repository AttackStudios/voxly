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

// strip secrets from a user record
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    tag: u.tag,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl || null,
    globalRank: u.globalRank || null,
    globalRankMeta: globalRankMeta(u.globalRank),
    status: u.status || 'offline',
  };
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
