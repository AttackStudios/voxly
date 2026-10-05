import { assetUrl } from '../lib/api.js';
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Modal } from './common.jsx';

export default function ServerRail() {
  const { servers, view, openHome, openServer, createServer, joinServer } = useApp();
  const [modal, setModal] = useState(null); // 'create' | 'join'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  async function doCreate() {
    if (!name.trim()) return;
    try { await createServer(name.trim()); setModal(null); setName(''); }
    catch (e) { setErr(e.message); }
  }
  async function doJoin() {
    try { await joinServer(code.trim()); setModal(null); setCode(''); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="server-rail">
      <button
        className={`rail-icon home ${view.type === 'home' ? 'active' : ''}`}
        onClick={openHome} title="Direct Messages">🏠</button>
      <div className="rail-sep" />
      {servers.map((s) => (
        <button key={s.id}
          className={`rail-icon ${view.type === 'server' && view.serverId === s.id ? 'active' : ''}`}
          style={{ background: s.iconUrl ? 'transparent' : s.iconColor }}
          onClick={() => openServer(s.id)} title={s.name}>
          {s.iconUrl ? <img className="rail-img" src={assetUrl(s.iconUrl)} alt={s.name} /> : s.name.slice(0, 2).toUpperCase()}
        </button>
      ))}
      <button className="rail-icon add" onClick={() => { setErr(''); setModal('create'); }} title="Add a server">＋</button>
      <button className="rail-icon join" onClick={() => { setErr(''); setModal('join'); }} title="Join a server">🔗</button>

      {modal === 'create' && (
        <Modal title="Create a Server" onClose={() => setModal(null)}
          footer={<button className="btn-primary" onClick={doCreate}>Create</button>}>
          {err && <div className="auth-error">{err}</div>}
          <label>Server name</label>
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doCreate()} placeholder="My Server" />
        </Modal>
      )}
      {modal === 'join' && (
        <Modal title="Join a Server" onClose={() => setModal(null)}
          footer={<button className="btn-primary" onClick={doJoin}>Join</button>}>
          {err && <div className="auth-error">{err}</div>}
          <label>Invite code</label>
          <input value={code} autoFocus onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && doJoin()} placeholder="ABC123" />
        </Modal>
      )}
    </div>
  );
}
