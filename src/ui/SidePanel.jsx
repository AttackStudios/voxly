import { useState, useEffect } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Modal, RankBadge } from './common.jsx';
import { api } from '../lib/api.js';
import { bus } from '../lib/bus.js';
import UserPanel from './UserPanel.jsx';

export default function SidePanel() {
  const app = useApp();
  const { view, serverData } = app;
  return (
    <div className="side-panel">
      {view.type === 'home' ? <HomePanel /> : <ServerPanel key={serverData?.server.id} />}
      <UserPanel />
    </div>
  );
}

function HomePanel() {
  const { me, dms, openDM, activeDmId, startDM } = useApp();
  const [showNew, setShowNew] = useState(false);

  const dmTitle = (c) =>
    c.isGroup ? (c.name || 'Group Chat')
      : c.participants.find((p) => p.id !== me.id)?.displayName || 'Direct Message';

  return (
    <>
      <div className="panel-head">
        <span>Direct Messages</span>
        <button className="icon-btn" title="New DM / Group" onClick={() => setShowNew(true)}>＋</button>
      </div>
      <div className="dm-list">
        {dms.length === 0 && <div className="empty-hint">No conversations yet. Click ＋ to start one.</div>}
        {dms.map((c) => (
          <button key={c.id} className={`dm-item ${activeDmId === c.id ? 'active' : ''}`} onClick={() => openDM(c.id)}>
            <div className="dm-avatar" style={{ background: c.isGroup ? '#5865F2' : (c.participants.find((p) => p.id !== me.id)?.avatarColor || '#5865F2') }}>
              {c.isGroup ? '👥' : (c.participants.find((p) => p.id !== me.id)?.displayName || '?').slice(0, 2).toUpperCase()}
            </div>
            <span className="dm-name">{dmTitle(c)}</span>
          </button>
        ))}
      </div>
      {showNew && <NewDMModal onClose={() => setShowNew(false)} onCreate={async (ids, name) => { await startDM(ids, name); setShowNew(false); }} />}
    </>
  );
}

function NewDMModal({ onClose, onCreate }) {
  const { me } = useApp();
  const [allUsers, setAllUsers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  useEffect(() => {
    api.users().then((d) => setAllUsers(d.users.filter((u) => u.id !== me.id))).catch(() => {});
  }, [me.id]);
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Modal title="New Message" onClose={onClose}
      footer={<button className="btn-primary" disabled={picked.length === 0} onClick={() => onCreate(picked, name)}>
        {picked.length > 1 ? 'Create Group' : 'Start Chat'}</button>}>
      {picked.length > 1 && (
        <>
          <label>Group name (optional)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group Chat" />
        </>
      )}
      <label>Select people</label>
      <div className="user-pick-list">
        {allUsers.map((u) => (
          <label key={u.id} className={`user-pick ${picked.includes(u.id) ? 'on' : ''}`}>
            <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
            <div className="dm-avatar small" style={{ background: u.avatarColor }}>{u.displayName.slice(0, 2).toUpperCase()}</div>
            <span>{u.displayName}<span className="tag">#{u.tag}</span></span>
            {u.globalRankMeta && <RankBadge rank={u.globalRankMeta} />}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ServerPanel() {
  const { serverData, activeChannelId, openChannel, createChannel, voiceStates } = useApp();
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  if (!serverData) return null;
  const { server, channels, myRank, isOwner } = serverData;
  const canManage = isOwner || ['admin', 'mod'].includes(myRank.key);
  const text = channels.filter((c) => c.type === 'text');
  const voice = channels.filter((c) => c.type === 'voice');

  return (
    <>
      <div className="panel-head server-head" onClick={() => setShowInvite(true)} title="Invite / settings">
        <span>{server.name}</span><span className="chev">▾</span>
      </div>
      <div className="channel-list">
        <div className="chan-cat">TEXT CHANNELS {canManage && <button className="icon-btn sm" onClick={() => setShowCreate('text')}>＋</button>}</div>
        {text.map((c) => (
          <button key={c.id} className={`chan-item ${activeChannelId === c.id ? 'active' : ''}`} onClick={() => openChannel(c.id)}>
            <span className="chan-hash">#</span>{c.name}
          </button>
        ))}
        <div className="chan-cat">VOICE CHANNELS {canManage && <button className="icon-btn sm" onClick={() => setShowCreate('voice')}>＋</button>}</div>
        {voice.map((c) => (
          <div key={c.id} className="voice-block">
            <button className="chan-item" onClick={() => bus.emit('call:start', { type: 'voice', channelId: c.id, video: false })}>
              <span className="chan-hash">🔊</span>{c.name}
            </button>
            {(voiceStates[c.id] || []).map((uid) => {
              const m = serverData.members.find((mm) => mm.id === uid);
              return <div key={uid} className="voice-user">🎙 {m?.displayName || 'User'}</div>;
            })}
          </div>
        ))}
      </div>

      {showCreate && <CreateChannelModal type={showCreate} onClose={() => setShowCreate(false)}
        onCreate={async (n, t) => { await createChannel(n, t); setShowCreate(false); }} />}
      {showInvite && <InviteModal server={server} onClose={() => setShowInvite(false)} />}
    </>
  );
}

function CreateChannelModal({ type, onClose, onCreate }) {
  const [name, setName] = useState('');
  return (
    <Modal title={`Create ${type === 'voice' ? 'Voice' : 'Text'} Channel`} onClose={onClose}
      footer={<button className="btn-primary" onClick={() => onCreate(name || 'new-channel', type)}>Create</button>}>
      <label>Channel name</label>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onCreate(name || 'new-channel', type)}
        placeholder={type === 'voice' ? 'General' : 'new-channel'} />
    </Modal>
  );
}

function InviteModal({ server, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={`Invite to ${server.name}`} onClose={onClose}>
      <p>Share this invite code so members can join the server:</p>
      <div className="invite-code-row">
        <code className="invite-code">{server.inviteCode}</code>
        <button className="btn-primary" onClick={() => { navigator.clipboard?.writeText(server.inviteCode); setCopied(true); }}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <p className="auth-note">They enter it via the 🔗 button on the left rail. (Accounts are still invite-only — created by the owner.)</p>
    </Modal>
  );
}
