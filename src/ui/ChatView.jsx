import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Avatar } from './common.jsx';
import { bus } from '../lib/bus.js';
import { uploadImage, assetUrl } from '../lib/api.js';
import { extractYouTubeIds } from '../lib/links.js';
import { renderMarkup } from '../lib/markup.jsx';
import { directory, useDirectory } from '../lib/directory.js';
import Embed from './Embed.jsx';
import { openProfile } from './ProfileCard.jsx';
import YouTubeEmbed from './YouTubeEmbed.jsx';
import Icon from './Icon.jsx';
import { UserTags } from './common.jsx';

export default function ChatView({ showMembers, toggleMembers }) {
  const app = useApp();
  const { me, view, serverData, activeChannelId, activeDmId, dms, messages, sendMessage, editMessage, deleteMessage, sendTyping, typing, presence } = app;
  useDirectory(); // re-render when names behind <@id> mentions load
  const [editingId, setEditingId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editText, setEditText] = useState('');
  const canModerate = !!(serverData && (serverData.isOwner || ['admin', 'mod'].includes(serverData.myRank?.key)));

  const isServer = view.type === 'server' && activeChannelId;
  const isDM = !!activeDmId;
  const key = activeChannelId ? `c:${activeChannelId}` : activeDmId ? `d:${activeDmId}` : null;
  const list = (key && messages[key]) || [];

  const channel = isServer && serverData ? serverData.channels.find((c) => c.id === activeChannelId) : null;
  const dm = isDM ? dms.find((c) => c.id === activeDmId) : null;
  const other = dm && !dm.isGroup ? dm.participants.find((p) => p.id !== me.id) : null;
  const title = isServer ? channel?.name : dm ? (dm.isGroup ? (dm.name || 'Group Chat') : other?.displayName) : '';

  const [text, setText] = useState('');
  const [pending, setPending] = useState([]); // images staged to send
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const lastTyped = useRef(0);

  // clear staged images when switching channels/DMs
  useEffect(() => { setPending([]); setText(''); setReplyTo(null); }, [key]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [list.length, key]);

  if (!key) {
    return (
      <div className="chat-view empty-chat">
        <div className="empty-state">
          <img className="empty-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Voxly" />
          <h2>Welcome to Voxly</h2>
          <p>Select a channel or a DM to start chatting. Create a server with the + button, or start a DM from the Home panel.</p>
        </div>
      </div>
    );
  }

  function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t && pending.length === 0) return;
    if (uploading) return; // wait for uploads to finish
    sendMessage(t, pending.map(({ url, name, type, size }) => ({ url, name, type, size })), replyTo ? { replyToId: replyTo.id } : {});
    setText('');
    setPending([]);
    setReplyTo(null);
  }
  function onChange(e) {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTyped.current > 1500) { lastTyped.current = now; sendTyping(); }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setUploading(true);
    for (const f of files.slice(0, 10)) {
      const localId = Math.random().toString(36).slice(2);
      setPending((p) => [...p, { localId, name: f.name, preview: URL.createObjectURL(f), uploading: true }]);
      try {
        const up = await uploadImage(f);
        setPending((p) => p.map((x) => (x.localId === localId ? { ...x, ...up, uploading: false } : x)));
      } catch (err) {
        setPending((p) => p.filter((x) => x.localId !== localId));
        app.pushToast({ title: 'Upload failed', body: err.message });
      }
    }
    setUploading(false);
  }
  function onPaste(e) {
    const imgs = Array.from(e.clipboardData?.items || []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  }
  function onDrop(e) {
    if (e.dataTransfer?.files?.length) { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }
  }

  const typingUsers = Object.entries(typing[key] || {})
    .filter(([uid, ts]) => uid !== me.id && Date.now() - ts < 4000)
    .map(([uid]) => uid);

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span className="chat-title">
          {isServer ? <Icon name="hash" className="chan-hash-icon" /> : <Icon name="at" className="chan-hash-icon" />} {title}
        </span>
        <div className="chat-header-actions">
          {isDM && (
            <>
              <button className="icon-btn" title="Start voice call"
                onClick={() => bus.emit('call:start', { type: 'dm', dmId: dm.id, targets: dm.participants.filter((p) => p.id !== me.id), video: false })}><Icon name="phone" /></button>
              <button className="icon-btn" title="Start video call"
                onClick={() => bus.emit('call:start', { type: 'dm', dmId: dm.id, targets: dm.participants.filter((p) => p.id !== me.id), video: true })}><Icon name="video" /></button>
              <button className="icon-btn" title="Share screen"
                onClick={() => bus.emit('call:start', { type: 'dm', dmId: dm.id, targets: dm.participants.filter((p) => p.id !== me.id), video: false, screen: true })}><Icon name="screen" /></button>
            </>
          )}
          {isServer && (
            <button className={`icon-btn ${showMembers ? 'active' : ''}`} title="Toggle members" onClick={toggleMembers}><Icon name="users" /></button>
          )}
        </div>
      </div>

      <div className="messages" ref={scrollRef}>
        <div className="messages-top">
          <h3># {title}</h3>
          <p>This is the beginning of {isServer ? 'the #' + title + ' channel' : 'your conversation'}.</p>
        </div>
        {list.map((m, i) => {
          const prev = list[i - 1];
          const grouped = !m.replyTo && prev && prev.authorId === m.authorId && (m.createdAt - prev.createdAt < 5 * 60 * 1000);
          const serverId = isServer ? serverData?.server.id : undefined;
          const mdOpts = { meId: me.id, meName: me.displayName, serverId,
            mentionNames: (m.mentions || []).map((id) => directory.user(id)?.displayName).filter(Boolean) };
          const mentionsMe = (m.mentions || []).includes(me.id);
          const mine = m.authorId === me.id;
          const editing = editingId === m.id;
          const startEdit = () => { setEditingId(m.id); setEditText(m.content || ''); };
          const saveEdit = () => { const t = editText.trim(); if (t) editMessage(m.id, t); setEditingId(null); };
          return (
            <div key={m.id} className={`msg ${grouped ? 'grouped' : ''} ${m.replyTo ? 'has-reply' : ''} ${mentionsMe ? 'mentioned' : ''}`}>
              {m.replyTo && (
                <div className="msg-reply-ref" onClick={() => document.getElementById(`m-${m.replyTo.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                  <span className="reply-spine" />
                  <Avatar user={m.replyTo.author} size={16} />
                  <span className="reply-name" style={{ color: m.replyTo.author?.globalRankMeta?.color }}>@{m.replyTo.author?.displayName}</span>
                  <span className="reply-text">{m.replyTo.content || 'Click to see attachment'}</span>
                </div>
              )}
              {!grouped && <button className="msg-av-btn" onClick={(e) => openProfile(e, m.authorId, serverId)}><Avatar user={m.author} size={40} /></button>}
              <div className="msg-body" id={`m-${m.id}`}>
                {!grouped && (
                  <div className="msg-head">
                    <span className="msg-author" style={{ color: m.author?.globalRankMeta?.color }} onClick={(e) => openProfile(e, m.authorId, serverId)}>{m.author?.displayName}</span>
                    <UserTags user={m.author} />
                    {m.author?.globalRankMeta && <span className="rank-badge" style={{ background: m.author.globalRankMeta.color }}>{m.author.globalRankMeta.label}</span>}
                    <span className="msg-time">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                )}
                {editing ? (
                  <div className="msg-edit">
                    <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }} />
                    <div className="msg-edit-hint">escape to <button className="link-btn" onClick={() => setEditingId(null)}>cancel</button> · enter to <button className="link-btn" onClick={saveEdit}>save</button></div>
                  </div>
                ) : (
                  m.content && <div className="msg-content">{renderMarkup(m.content, mdOpts)}{m.editedAt && <span className="edited-tag" title={new Date(m.editedAt).toLocaleString()}> (edited)</span>}</div>
                )}
                {!editing && extractYouTubeIds(m.content || '').map((vid) => <YouTubeEmbed key={vid} id={vid} />)}
                {m.embeds?.map((e, j) => <Embed key={j} e={e} opts={mdOpts} />)}
                {m.attachments?.length > 0 && (
                  <div className="msg-attachments">
                    {m.attachments.map((a, j) => (
                      <a key={j} href={assetUrl(a.url)} target="_blank" rel="noreferrer" className="attach-img">
                        <img src={assetUrl(a.url)} alt={a.name} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {!editing && (
                <div className="msg-actions">
                  <button title="Reply" onClick={() => setReplyTo(m)}><Icon name="reply" size={18} /></button>
                  {mine && m.content && <button title="Edit" onClick={startEdit}><Icon name="edit" size={18} /></button>}
                  {(mine || canModerate) && <button title="Delete" onClick={() => { if (window.confirm('Delete this message?')) deleteMessage(m.id); }} className="danger"><Icon name="trash" size={18} /></button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="typing-line">
        {typingUsers.length > 0 && <span>Someone is typing…</span>}
      </div>

      {pending.length > 0 && (
        <div className="attach-tray">
          {pending.map((p) => (
            <div key={p.localId} className={`attach-chip ${p.uploading ? 'loading' : ''}`}>
              <img src={p.preview} alt={p.name} />
              {p.uploading && <div className="attach-spin"><Icon name="clock" size={22} /></div>}
              <button className="attach-remove" onClick={() => setPending((arr) => arr.filter((x) => x.localId !== p.localId))}><Icon name="close" size={12} stroke={3} /></button>
            </div>
          ))}
        </div>
      )}

      {replyTo && (
        <div className="reply-bar">
          Replying to <b>{replyTo.author?.displayName}</b>
          <button type="button" onClick={() => setReplyTo(null)} title="Cancel reply"><Icon name="close" size={10} stroke={3} /></button>
        </div>
      )}
      <form className={`composer ${dragOver ? 'drag' : ''} ${replyTo ? 'replying' : ''}`} onSubmit={submit}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
        <input type="file" accept="image/*" multiple ref={fileInputRef} style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className="attach-btn" title="Upload image" onClick={() => fileInputRef.current?.click()}><Icon name="plus" size={20} stroke={2.5} /></button>
        <input className="composer-text" value={text} onChange={onChange} onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === 'Escape' && replyTo) setReplyTo(null); }}
          placeholder={dragOver ? 'Drop images to upload…' : `Message ${isServer ? '#' + title : title}`} />
        <button className="send-btn" type="submit" disabled={uploading}>{uploading ? 'Uploading…' : 'Send'}</button>
      </form>
    </div>
  );
}
