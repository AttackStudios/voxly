import { useState, useRef } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Avatar, Modal, RankBadge } from './common.jsx';
import { api, uploadImage } from '../lib/api.js';

export default function UserPanel() {
  const { me, logout } = useApp();
  const [showSettings, setShowSettings] = useState(false);
  return (
    <div className="user-panel">
      <Avatar user={me} size={32} status="online" />
      <div className="user-panel-meta">
        <div className="user-panel-name">
          {me.displayName}
          {me.globalRankMeta && <RankBadge rank={me.globalRankMeta} />}
        </div>
        <div className="user-panel-tag">#{me.tag}</div>
      </div>
      <button className="icon-btn" title="Settings" onClick={() => setShowSettings(true)}>⚙️</button>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onLogout={logout} />}
    </div>
  );
}

function SettingsModal({ onClose, onLogout }) {
  const { me, pushToast } = useApp();
  const [name, setName] = useState(me.displayName);
  const [color, setColor] = useState(me.avatarColor);
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl || null);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3498db', '#9b59b6', '#1abc9c'];

  async function pickAvatar(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const up = await uploadImage(file);
      setAvatarUrl(up.url);
    } catch (e) {
      pushToast({ title: 'Upload failed', body: e.message });
    } finally { setUploading(false); }
  }

  async function save() {
    await api.updateMe({ displayName: name, avatarColor: color, avatarUrl: avatarUrl || '' });
    setSaved(true);
    setTimeout(() => window.location.reload(), 400);
  }

  return (
    <Modal title="User Settings" onClose={onClose}
      footer={<>
        <button className="btn-danger" onClick={onLogout}>Log Out</button>
        <button className="btn-primary" onClick={save} disabled={uploading}>{uploading ? 'Uploading…' : saved ? 'Saved!' : 'Save'}</button>
      </>}>
      <div className="settings-row">
        <button className="avatar-edit" onClick={() => fileRef.current?.click()} title="Change profile picture">
          <Avatar user={{ displayName: name, avatarColor: color, avatarUrl }} size={72} />
          <span className="avatar-edit-overlay">{uploading ? '…' : '📷'}</span>
        </button>
        <input type="file" accept="image/*" ref={fileRef} style={{ display: 'none' }}
          onChange={(e) => { pickAvatar(e.target.files[0]); e.target.value = ''; }} />
        <div>
          <div className="user-panel-name big">{name}<span className="tag">#{me.tag}</span></div>
          {me.globalRankMeta && <RankBadge rank={me.globalRankMeta} />}
          <div className="muted small">{me.email}</div>
          <div className="avatar-actions">
            <button className="link-btn" onClick={() => fileRef.current?.click()}>Upload image</button>
            {avatarUrl && <button className="link-btn danger" onClick={() => setAvatarUrl(null)}>Remove</button>}
          </div>
        </div>
      </div>
      <label>Display name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label>Avatar color {avatarUrl && <span className="muted small">(shown when no image)</span>}</label>
      <div className="color-row">
        {colors.map((c) => (
          <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      {!window.desktop && (
        <>
          <label>Notifications</label>
          <div className="muted small" style={{ marginBottom: 8 }}>Status: {notifStatus()}</div>
          <button className="btn-primary" onClick={testNotification}>🔔 Send test notification</button>
        </>
      )}
    </Modal>
  );
}

function notifStatus() {
  if (!('Notification' in window)) return 'not supported in this browser';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

function testNotification() {
  if (!('Notification' in window)) { alert('This browser does not support notifications.'); return; }
  const fire = () => {
    try {
      const n = new Notification('Voxly', { body: 'Notifications are working! 🎉', icon: `${import.meta.env.BASE_URL}favicon.svg` });
      n.onclick = () => window.focus();
    } catch (e) { alert('Could not show notification: ' + e.message); }
  };
  if (Notification.permission === 'granted') fire();
  else if (Notification.permission === 'denied') alert('Notifications are blocked. Click the lock/🔒 icon left of the address bar → Notifications → Allow, then reload.');
  else Notification.requestPermission().then((p) => { if (p === 'granted') fire(); else alert('Permission was not granted.'); });
}
