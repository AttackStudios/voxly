import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { api, setToken, getToken } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';
import { bus } from '../lib/bus.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState([]);
  const [dms, setDms] = useState([]);
  const [view, setView] = useState({ type: 'home' }); // {type:'home'} | {type:'server', serverId}
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [activeDmId, setActiveDmId] = useState(null);
  const [serverData, setServerData] = useState(null); // {server, channels, members, myRank, isOwner}
  const [messages, setMessages] = useState({}); // key -> []
  const [presence, setPresence] = useState({}); // userId -> status
  const [voiceStates, setVoiceStates] = useState({}); // channelId -> [userId]
  const [toasts, setToasts] = useState([]);
  const [typing, setTyping] = useState({}); // key -> {userId: ts}
  const socketRef = useRef(null);

  const keyFor = (channelId, dmId) => (channelId ? `c:${channelId}` : `d:${dmId}`);

  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    if (window.desktop?.showToast) {
      // Electron: custom bottom-right toast window (floats over other apps)
      window.desktop.showToast(t);
    } else if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
      // Browser: OS notification whenever the Voxly window isn't focused (covers
      // "switched to another app" even when the browser is still visible behind it)
      try {
        const n = new Notification(t.title || 'Voxly', { body: t.body || '', icon: `${import.meta.env.BASE_URL}favicon.svg`, tag: id });
        n.onclick = () => { window.focus(); if (t.dmId) openDM(t.dmId); };
      } catch {}
    }
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 8000);
  }, []);
  const dismissToast = (id) => setToasts((prev) => prev.filter((x) => x.id !== id));

  // Browser: ask for OS-notification permission once logged in (Electron uses its
  // own toast window and doesn't need this).
  useEffect(() => {
    if (me && !window.desktop && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [me]);

  // ---- bootstrap from saved token ----
  useEffect(() => {
    (async () => {
      if (!getToken()) { setLoading(false); return; }
      try {
        const data = await api.me();
        setMe(data.user);
        setServers(data.servers);
        setDms(data.dms);
        bootSocket();
      } catch {
        setToken(null);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, []);

  function bootSocket() {
    const s = connectSocket();
    socketRef.current = s;

    // Bind event handlers only once per socket instance. bootSocket can run more
    // than once (React StrictMode double-invokes effects, re-login, etc.); without
    // this guard every handler would stack and fire N times — e.g. a created
    // channel would be appended to state twice (the "duplicate channel" bug).
    if (s._dcBound) return s;
    s._dcBound = true;

    s.on('message:new', (msg) => {
      const k = keyFor(msg.channelId, msg.dmId);
      setMessages((prev) => {
        const arr = prev[k] || [];
        if (arr.some((m) => m.id === msg.id)) return prev; // never render the same message twice
        return { ...prev, [k]: [...arr, msg] };
      });
    });
    s.on('message:updated', (msg) => {
      const k = keyFor(msg.channelId, msg.dmId);
      setMessages((prev) => ({ ...prev, [k]: (prev[k] || []).map((m) => (m.id === msg.id ? msg : m)) }));
    });
    s.on('message:deleted', ({ id, channelId, dmId }) => {
      const k = keyFor(channelId, dmId);
      setMessages((prev) => ({ ...prev, [k]: (prev[k] || []).filter((m) => m.id !== id) }));
    });
    s.on('presence:update', ({ userId, status }) =>
      setPresence((p) => ({ ...p, [userId]: status })));
    s.on('typing', ({ userId, channelId, dmId }) => {
      const k = keyFor(channelId, dmId);
      setTyping((t) => ({ ...t, [k]: { ...(t[k] || {}), [userId]: Date.now() } }));
    });
    s.on('dm:created', ({ conversation }) => setDms((d) => dedupe([conversation, ...d])));
    s.on('dm:updated', ({ conversation }) =>
      setDms((d) => dedupe([conversation, ...d.filter((x) => x.id !== conversation.id)])));
    s.on('channel:created', ({ channel }) => {
      setServerData((sd) => (sd && sd.server.id === channel.serverId && !sd.channels.find((c) => c.id === channel.id)
        ? { ...sd, channels: [...sd.channels, channel] } : sd));
      s.emit('room:join', { channelId: channel.id });
    });
    s.on('server:member-joined', ({ serverId, member }) =>
      setServerData((sd) => (sd && sd.server.id === serverId && !sd.members.find((m) => m.id === member.id)
        ? { ...sd, members: [...sd.members, member] } : sd)));
    s.on('server:member-updated', ({ serverId, member }) =>
      setServerData((sd) => (sd && sd.server.id === serverId
        ? { ...sd, members: sd.members.map((m) => (m.id === member.id ? member : m)) } : sd)));
    s.on('voice:state', ({ channelId, userId, joined }) =>
      setVoiceStates((v) => {
        const set = new Set(v[channelId] || []);
        joined ? set.add(userId) : set.delete(userId);
        return { ...v, [channelId]: [...set] };
      }));

    s.on('notify', (n) => {
      // Only suppress when you're ACTIVELY looking at that conversation, i.e. the
      // window is focused AND that DM/channel is open. If the window is in the
      // background, always notify — even if that conversation happens to be open.
      const viewingDm = n.dmId && n.dmId === activeDmRef.current;
      const viewingCh = n.channelId && n.channelId === activeChannelRef.current;
      if (document.hasFocus() && (viewingDm || viewingCh)) return;
      const who = n.from?.displayName || 'Someone';
      pushToast({
        title: n.mention
          ? `${who} mentioned you${n.channelName ? ' in #' + n.channelName : ''}`
          : (n.from?.displayName || 'New message'),
        body: n.content,
        from: n.from,
        dmId: n.dmId,
        channelId: n.channelId,
        kind: n.kind,
        channelName: n.channelName,
        mention: n.mention,
      });
    });
    return s;
  }

  // refs so socket handlers see current active view without re-binding
  const activeDmRef = useRef(null);
  const activeChannelRef = useRef(null);
  useEffect(() => { activeDmRef.current = activeDmId; }, [activeDmId]);
  useEffect(() => { activeChannelRef.current = activeChannelId; }, [activeChannelId]);

  // act on actions taken inside the native Electron toast (reply / call / open)
  useEffect(() => {
    if (!window.desktop?.onToastAction) return;
    window.desktop.onToastAction(({ action, toast, text }) => {
      if (!toast) return;
      if (action === 'reply' && text) {
        const payload = toast.dmId ? { dmId: toast.dmId, content: text } : { channelId: toast.channelId, content: text };
        socketRef.current?.emit('message:send', payload);
      } else if (action === 'call' && toast.from) {
        bus.emit('call:start', { type: 'dm', dmId: toast.dmId, targets: [toast.from], video: false, startDmWith: toast.from.id });
      } else if (action === 'open') {
        if (toast.dmId) openDM(toast.dmId);
        else if (toast.serverId) openServer(toast.serverId).then(() => toast.channelId && openChannel(toast.channelId));
      }
    });
    // eslint-disable-next-line
  }, []);

  // ---- auth ----
  async function login(email, password) {
    return startSession(await api.login(email, password));
  }
  async function register(body) {
    return startSession(await api.register(body));
  }
  async function startSession({ token, user }) {
    setToken(token);
    setMe(user);
    const data = await api.me();
    setServers(data.servers);
    setDms(data.dms);
    bootSocket();
    return user;
  }
  function logout() {
    disconnectSocket();
    setToken(null);
    setMe(null); setServers([]); setDms([]); setServerData(null);
    setView({ type: 'home' });
  }

  // ---- navigation / loading ----
  async function openServer(serverId) {
    setView({ type: 'server', serverId });
    setActiveDmId(null);
    const data = await api.getServer(serverId);
    setServerData(data);
    if (data.voice) setVoiceStates((v) => ({ ...v, ...data.voice })); // who's already in voice
    const firstText = data.channels.find((c) => c.type === 'text');
    if (firstText) openChannel(firstText.id);
  }
  async function openChannel(channelId) {
    setActiveChannelId(channelId);
    setActiveDmId(null);
    const k = `c:${channelId}`;
    if (!messages[k]) {
      const { messages: hist } = await api.channelMessages(channelId);
      setMessages((prev) => ({ ...prev, [k]: hist }));
    }
  }
  async function openHome() {
    setView({ type: 'home' });
    setActiveChannelId(null);
    setServerData(null);
    const { conversations } = await api.getDMs();
    setDms(conversations);
  }
  async function openDM(dmId) {
    setView({ type: 'home' });
    setServerData(null);
    setActiveChannelId(null);
    setActiveDmId(dmId);
    const k = `d:${dmId}`;
    if (!messages[k]) {
      const { messages: hist } = await api.dmMessages(dmId);
      setMessages((prev) => ({ ...prev, [k]: hist }));
    }
  }

  // ---- actions ----
  function sendMessage(content, attachments = []) {
    const base = activeChannelId ? { channelId: activeChannelId } : { dmId: activeDmId };
    socketRef.current?.emit('message:send', { ...base, content, attachments });
  }
  function editMessage(messageId, content) {
    socketRef.current?.emit('message:edit', { messageId, content });
  }
  function deleteMessage(messageId) {
    socketRef.current?.emit('message:delete', { messageId });
  }
  function sendTyping() {
    const payload = activeChannelId ? { channelId: activeChannelId } : { dmId: activeDmId };
    socketRef.current?.emit('typing', payload);
  }
  async function createServer(name) {
    const { server, firstChannelId } = await api.createServer(name);
    setServers((s) => [...s, server]);
    socketRef.current?.emit('room:join', { serverId: server.id });
    await openServer(server.id);
    return { server, firstChannelId };
  }
  async function joinServer(code) {
    const { server } = await api.joinServer(code);
    setServers((s) => (s.find((x) => x.id === server.id) ? s : [...s, server]));
    socketRef.current?.emit('room:join', { serverId: server.id });
    await openServer(server.id);
  }
  async function createChannel(name, type) {
    if (!serverData) return;
    await api.createChannel(serverData.server.id, name, type);
  }
  async function startDM(participantIds, name) {
    const { conversation } = await api.createDM(participantIds, name);
    setDms((d) => dedupe([conversation, ...d]));
    socketRef.current?.emit('room:join', { dmId: conversation.id });
    await openDM(conversation.id);
    return conversation;
  }
  async function setMemberRank(userId, rank) {
    if (!serverData) return;
    await api.setRank(serverData.server.id, userId, rank);
  }

  const value = {
    me, loading, servers, dms, view, serverData,
    activeChannelId, activeDmId, messages, presence, voiceStates, typing,
    toasts, pushToast, dismissToast,
    socket: socketRef,
    login, register, logout, openServer, openChannel, openHome, openDM,
    sendMessage, editMessage, deleteMessage, sendTyping, createServer, joinServer, createChannel, startDM, setMemberRank,
    setVoiceStates,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
}
