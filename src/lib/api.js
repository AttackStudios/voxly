// REST client. In dev, Vite proxies /api -> :3001. In Electron/prod we can
// point at an absolute base via VITE_API_BASE.
const BASE = import.meta.env.VITE_API_BASE || '';

let token = localStorage.getItem('dc_token') || null;
export const getToken = () => token;

// Resolve an uploaded-asset path to an absolute URL when the API lives on a
// different origin (packaged desktop app loads from file://, so '/uploads/..'
// must point at the backend). In dev/web, BASE is '' and paths stay relative.
export const assetUrl = (u) => (u && u.startsWith('/uploads') ? BASE + u : u);
export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('dc_token', t);
  else localStorage.removeItem('dc_token');
}

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Upload one image file (raw binary body). Returns { url, name, type, size }.
export async function uploadImage(file) {
  const res = await fetch(`${BASE}/api/upload?name=${encodeURIComponent(file.name || 'image')}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

export const api = {
  login: (email, password) => req('POST', '/api/login', { email, password }),
  register: (body) => req('POST', '/api/register', body),
  config: () => req('GET', '/api/config'),
  me: () => req('GET', '/api/me'),
  updateMe: (patch) => req('PATCH', '/api/me', patch),
  users: () => req('GET', '/api/users'),
  ranks: () => req('GET', '/api/ranks'),

  createServer: (name) => req('POST', '/api/servers', { name }),
  getServer: (id) => req('GET', `/api/servers/${id}`),
  joinServer: (code) => req('POST', '/api/servers/join', { code }),
  createChannel: (serverId, name, type) => req('POST', `/api/servers/${serverId}/channels`, { name, type }),
  setRank: (serverId, userId, rank) => req('POST', `/api/servers/${serverId}/rank`, { userId, rank }),
  channelMessages: (id) => req('GET', `/api/channels/${id}/messages`),

  createDM: (participantIds, name) => req('POST', '/api/dms', { participantIds, name }),
  getDMs: () => req('GET', '/api/dms'),
  addToDM: (id, userId) => req('POST', `/api/dms/${id}/add`, { userId }),
  dmMessages: (id) => req('GET', `/api/dms/${id}/messages`),

  profile: (userId, serverId) => req('GET', `/api/users/${userId}/profile${serverId ? `?serverId=${serverId}` : ''}`),
  updateServer: (id, patch) => req('PATCH', `/api/servers/${id}`, patch),
  newInvite: (id) => req('POST', `/api/servers/${id}/invite`),
  deleteServer: (id) => req('DELETE', `/api/servers/${id}`),
  removeMember: (serverId, userId) => req('DELETE', `/api/servers/${serverId}/members/${userId}`),
  addBot: (serverId, botId) => req('POST', `/api/servers/${serverId}/bots`, { botId }),

  adminUsers: (q) => req('GET', `/api/admin/users?q=${encodeURIComponent(q || '')}`),
  adminUpdateUser: (id, patch) => req('PATCH', `/api/admin/users/${id}`, patch),
  resolveLink: (url) => req('GET', `/api/resolve-link?url=${encodeURIComponent(url)}`),
  bots: () => req('GET', '/api/bots'),
  createBot: (body) => req('POST', '/api/bots', body),
  updateBot: (id, patch) => req('PATCH', `/api/bots/${id}`, patch),
  resetBotToken: (id) => req('POST', `/api/bots/${id}/token`),
  deleteBot: (id) => req('DELETE', `/api/bots/${id}`),
};
