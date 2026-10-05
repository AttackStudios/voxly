// Tiny shared cache of users + channels so message text can render <@id> /
// <#id> as names, and profile cards can open instantly. Components subscribe
// with useDirectory() and re-render when it changes.
import { useEffect, useState } from 'react';

const users = new Map();     // id -> public user
const channels = new Map();  // id -> { id, name, serverId }
const subs = new Set();
let version = 0;
let timer = null;
const notify = () => {
  if (timer) return;
  timer = setTimeout(() => { timer = null; version++; subs.forEach((f) => f(version)); }, 0);
};

export const directory = {
  user: (id) => users.get(id) || null,
  channel: (id) => channels.get(id) || null,
  putUsers(list) { (list || []).forEach((u) => u && u.id && users.set(u.id, { ...users.get(u.id), ...u })); notify(); },
  putChannels(list) { (list || []).forEach((c) => c && c.id && channels.set(c.id, c)); notify(); },
};

export function useDirectory() {
  const [, setV] = useState(version);
  useEffect(() => { subs.add(setV); return () => subs.delete(setV); }, []);
  return directory;
}
