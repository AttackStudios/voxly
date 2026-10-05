import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { bus } from '../lib/bus.js';

export default function Toasts() {
  const { toasts, dismissToast, openDM, openChannel, openServer, socket } = useApp();
  return (
    <div className="toast-stack">
      {toasts.map((t) => <Toast key={t.id} t={t} onClose={() => dismissToast(t.id)}
        onOpen={() => { t.dmId ? openDM(t.dmId) : (t.serverId && openServer(t.serverId).then(() => openChannel(t.channelId))); dismissToast(t.id); }}
        onReply={(text) => {
          const payload = t.dmId ? { dmId: t.dmId, content: text } : { channelId: t.channelId, content: text };
          socket.current?.emit('message:send', payload);
          dismissToast(t.id);
        }}
        onCall={() => { if (t.from) bus.emit('call:start', { type: 'dm', dmId: t.dmId, targets: [t.from], video: false, startDmWith: t.from.id }); dismissToast(t.id); }}
      />)}
    </div>
  );
}

function Toast({ t, onClose, onOpen, onReply, onCall }) {
  const [reply, setReply] = useState('');
  return (
    <div className="toast">
      <div className="toast-head" onClick={onOpen}>
        <div className="toast-avatar" style={{ background: t.from?.avatarColor || '#5865F2' }}>
          {(t.from?.displayName || '?').slice(0, 2).toUpperCase()}
        </div>
        <div className="toast-meta">
          <div className="toast-title">
            {t.from?.displayName || t.title}
            {t.kind === 'channel' && <span className="toast-where"> · #{t.channelName}</span>}
          </div>
          <div className="toast-body">{t.body}</div>
        </div>
        <button className="toast-x" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
      </div>
      {t.link && (
        <div className="toast-actions">
          <a className="toast-link" href={t.link} target="_blank" rel="noreferrer" onClick={onClose}>Get the desktop app</a>
        </div>
      )}
      {(t.dmId || t.channelId) && (
      <div className="toast-actions">
        <input className="toast-reply" placeholder="Quick reply…" value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) onReply(reply.trim()); }} />
        <button className="toast-btn" title="Send" onClick={() => reply.trim() && onReply(reply.trim())}>➤</button>
        {t.dmId && <button className="toast-btn call" title="Call" onClick={onCall}>📞</button>}
      </div>
      )}
    </div>
  );
}
