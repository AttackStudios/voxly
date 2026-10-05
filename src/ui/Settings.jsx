import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { api, uploadImage, assetUrl } from '../lib/api.js';
import { bus } from '../lib/bus.js';
import { Avatar, UserTags } from './common.jsx';
import { ProfileCard } from './ProfileCard.jsx';
import { sfx } from '../lib/sounds.js';
import Icon from './Icon.jsx';

const COLORS = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3498db', '#9b59b6', '#1abc9c', '#e67e22', '#2c2f33'];
const DOCS = 'https://github.com/AttackStudios/voxly/blob/worktree-web/BOTS.md';

// Discord-style full-screen settings: sidebar on the left, page on the right,
// ESC / the close button to close, and a sticky "unsaved changes" bar.
function SettingsShell({ sections, tab, setTab, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="st">
      <nav className="st-side">
        <div className="st-side-inner">
          {sections.map((s, i) => s.heading
            ? <div key={i} className="st-heading">{s.heading}</div>
            : s.sep ? <div key={i} className="st-sep" />
              : <button key={s.id} className={`st-item ${tab === s.id ? 'on' : ''} ${s.danger ? 'danger' : ''}`}
                onClick={() => (s.onClick ? s.onClick() : setTab(s.id))}>{s.label}</button>)}
        </div>
      </nav>
      <main className="st-main">
        <div className="st-content">{children}</div>
        <div className="st-close">
          <button onClick={onClose} title="Close (Esc)"><Icon name="close" size={18} /></button><span>ESC</span>
        </div>
      </main>
    </div>
  );
}

function SaveBar({ dirty, saving, onReset, onSave }) {
  if (!dirty) return null;
  return (
    <div className="st-savebar">
      <span>Careful — you have unsaved changes!</span>
      <button className="link-btn" onClick={onReset}>Reset</button>
      <button className="btn-success" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
    </div>
  );
}

function ImagePick({ onPicked, children, className }) {
  const ref = useRef(null);
  const { pushToast } = useApp();
  const [busy, setBusy] = useState(false);
  async function pick(f) {
    if (!f || !f.type.startsWith('image/')) return;
    setBusy(true);
    try { onPicked((await uploadImage(f)).url); } catch (e) { pushToast({ title: 'Upload failed', body: e.message }); }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()} disabled={busy}>{busy ? 'Uploading…' : children}</button>
      <input type="file" accept="image/*" ref={ref} hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
    </>
  );
}

// ======================= USER SETTINGS =======================
export function UserSettings({ initialTab = 'account', onClose }) {
  const { logout, me } = useApp();
  const [tab, setTab] = useState(initialTab);
  const sections = [
    { heading: 'User Settings' },
    { id: 'account', label: 'My Account' },
    { id: 'profile', label: 'Profiles' },
    { sep: true }, { heading: 'App Settings' },
    { id: 'notifications', label: 'Notifications' },
    { sep: true }, { heading: 'Developers' },
    { id: 'developer', label: 'Developer Portal' },
    ...(me.globalRank === 'owner' ? [{ id: 'admin', label: 'Admin' }] : []),
    { sep: true },
    { id: 'logout', label: 'Log Out', danger: true, onClick: logout },
  ];
  return (
    <SettingsShell sections={sections} tab={tab} setTab={setTab} onClose={onClose}>
      {tab === 'account' && <AccountPage goProfile={() => setTab('profile')} />}
      {tab === 'profile' && <ProfilePage />}
      {tab === 'notifications' && <NotificationsPage />}
      {tab === 'developer' && <DeveloperPage />}
      {tab === 'admin' && <AdminPage />}
    </SettingsShell>
  );
}

function AccountPage({ goProfile }) {
  const { me } = useApp();
  return (
    <>
      <h1>My Account</h1>
      <div className="acct-card">
        <div className="acct-banner" style={me.bannerUrl ? { backgroundImage: `url(${assetUrl(me.bannerUrl)})` } : { background: me.bannerColor || me.avatarColor }} />
        <div className="acct-row">
          <div className="acct-av"><Avatar user={me} size={80} status="online" /></div>
          <div className="acct-name">{me.displayName}<span className="tag">#{me.tag}</span></div>
          <button className="btn-primary" onClick={goProfile}>Edit User Profile</button>
        </div>
        <div className="acct-fields">
          <div className="acct-field"><div><div className="st-label">Display Name</div>{me.displayName}</div><button className="btn-ghost" onClick={goProfile}>Edit</button></div>
          <div className="acct-field"><div><div className="st-label">Username</div>{me.displayName.toLowerCase().replace(/\s+/g, '')}#{me.tag}</div></div>
          <div className="acct-field"><div><div className="st-label">Email</div>{me.email}</div></div>
        </div>
      </div>
    </>
  );
}

function ProfilePage() {
  const { me, setMe, pushToast } = useApp();
  const initial = () => ({
    displayName: me.displayName, avatarUrl: me.avatarUrl || null, avatarColor: me.avatarColor,
    bannerUrl: me.bannerUrl || null, bannerColor: me.bannerColor || null,
    pronouns: me.pronouns || '', aboutMe: me.aboutMe || '', customStatus: me.customStatus || '',
  });
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial());

  async function save() {
    if (!f.displayName.trim()) return pushToast({ title: 'Display name can’t be empty' });
    setSaving(true);
    try {
      const { user } = await api.updateMe({ ...f, avatarUrl: f.avatarUrl || '', bannerUrl: f.bannerUrl || '' });
      setMe(user);
    } catch (e) { pushToast({ title: 'Couldn’t save', body: e.message }); }
    setSaving(false);
  }

  return (
    <>
      <h1>Profiles</h1>
      <div className="prof-grid">
        <div className="prof-form">
          <div className="st-label">Display Name</div>
          <input value={f.displayName} onChange={set('displayName')} maxLength={32} />
          <div className="st-label">Pronouns</div>
          <input value={f.pronouns} onChange={set('pronouns')} maxLength={40} placeholder="Add your pronouns" />
          <div className="st-divider" />
          <div className="st-label">Avatar</div>
          <div className="st-btnrow">
            <ImagePick className="btn-primary" onPicked={set('avatarUrl')}>Change Avatar</ImagePick>
            {f.avatarUrl && <button className="link-btn" onClick={() => set('avatarUrl')(null)}>Remove Avatar</button>}
          </div>
          <div className="st-label">Avatar Colour <span className="muted small">(shown when there’s no image)</span></div>
          <div className="color-row">{COLORS.map((c) => <button key={c} className={`swatch ${f.avatarColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('avatarColor')(c)} />)}</div>
          <div className="st-divider" />
          <div className="st-label">Profile Banner</div>
          <div className="st-btnrow">
            <ImagePick className="btn-primary" onPicked={set('bannerUrl')}>Change Banner</ImagePick>
            {f.bannerUrl && <button className="link-btn" onClick={() => set('bannerUrl')(null)}>Remove Banner</button>}
          </div>
          <div className="st-label">Banner Colour</div>
          <div className="color-row">
            {COLORS.map((c) => <button key={c} className={`swatch ${f.bannerColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('bannerColor')(c)} />)}
            <input type="color" className="swatch-custom" value={f.bannerColor || '#5865f2'} onChange={set('bannerColor')} title="Custom colour" />
          </div>
          <div className="st-divider" />
          <div className="st-label">About Me</div>
          <div className="st-hint">You can use markdown and links if you’d like.</div>
          <textarea value={f.aboutMe} onChange={set('aboutMe')} maxLength={190} rows={4} />
          <div className="st-count">{190 - f.aboutMe.length}</div>
          <div className="st-label">Custom Status</div>
          <input value={f.customStatus} onChange={set('customStatus')} maxLength={128} placeholder="What’s happening?" />
        </div>
        <div className="prof-preview">
          <div className="st-label">Preview</div>
          <ProfileCard preview={{ ...me, ...f }} />
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onReset={() => setF(initial())} onSave={save} />
    </>
  );
}

const SOUND_LABELS = [
  ['message', 'Message'], ['mention', 'Mention'], ['join', 'User join'], ['leave', 'User leave'],
  ['mute', 'Mute'], ['unmute', 'Unmute'], ['streamStart', 'Stream start'], ['streamStop', 'Stream stop'],
  ['ring', 'Incoming ring'], ['ringback', 'Outgoing ring'], ['hangup', 'Disconnect'], ['request', 'Control request'],
];
function SoundSettings() {
  const [s, setS] = useState(sfx.settings());
  const update = (patch) => { sfx.save(patch); setS(sfx.settings()); };
  return (
    <>
      <div className="st-label">Sounds</div>
      <label className="st-toggle">
        <span>Play sounds for messages, calls and voice</span>
        <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        <i />
      </label>
      <div className="st-label">Volume</div>
      <input type="range" className="st-range" min="0" max="1" step="0.05" value={s.volume}
        onChange={(e) => update({ volume: +e.target.value })} onMouseUp={() => sfx.play('message')} />
      <div className="st-label">Preview</div>
      <div className="sound-grid">
        {SOUND_LABELS.map(([id, label]) => (
          <button key={id} className="sound-chip" onClick={() => sfx.play(id)} disabled={!s.enabled}>
            <Icon name="play" size={10} /> {label}
          </button>
        ))}
      </div>
    </>
  );
}

function NotificationsPage() {
  const status = !('Notification' in window) ? 'not supported in this browser' : Notification.permission;
  function test() {
    if (!('Notification' in window)) return;
    const fire = () => new Notification('Voxly', { body: 'Notifications are working!', icon: `${import.meta.env.BASE_URL}favicon.svg` });
    if (Notification.permission === 'granted') fire();
    else Notification.requestPermission().then((p) => p === 'granted' && fire());
  }
  return (
    <>
      <h1>Notifications</h1>
      <SoundSettings />
      <div className="st-divider" />
      <div className="st-label">Desktop notifications</div>
      {window.desktop ? <p className="st-hint">The desktop app shows its own notifications in the corner of your screen.</p> : (
        <>
          <p className="st-hint">Browser permission: <b>{status}</b>. If it says “denied”, click the lock icon left of the address bar → Notifications → Allow.</p>
          <button className="btn-primary" onClick={test}><Icon name="bell" size={16} /> Send test notification</button>
        </>
      )}
    </>
  );
}

// ---------------- Developer Portal ----------------
function DeveloperPage() {
  const { pushToast } = useApp();
  const [bots, setBots] = useState(null);
  const [name, setName] = useState('');
  const [reveal, setReveal] = useState(null); // { botId, token }
  const load = () => api.bots().then((d) => setBots(d.bots)).catch((e) => pushToast({ title: 'Error', body: e.message }));
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const { bot, token } = await api.createBot({ name: name.trim() });
      setName(''); setReveal({ botId: bot.id, token }); load();
    } catch (err) { pushToast({ title: 'Couldn’t create bot', body: err.message }); }
  }

  return (
    <>
      <h1>Developer Portal</h1>
      <p className="st-hint">
        Make bots that can read and send messages, post rich embeds and reply to commands — like Discord bots.
        Read the <a href={DOCS} target="_blank" rel="noreferrer">Bot API docs</a>.
      </p>
      <form className="dev-new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bot name, e.g. Cat Bot" maxLength={32} />
        <button className="btn-primary" disabled={!name.trim()}><Icon name="plus" size={16} stroke={2.5} /> New Bot</button>
      </form>
      {bots === null && <div className="st-hint">Loading…</div>}
      {bots?.length === 0 && <div className="dev-empty">You haven’t made any bots yet.</div>}
      {bots?.map((b) => (
        <BotCard key={b.id} bot={b} reload={load} reveal={reveal?.botId === b.id ? reveal.token : null}
          onToken={(token) => setReveal({ botId: b.id, token })} />
      ))}
    </>
  );
}

function BotCard({ bot, reload, reveal, onToken }) {
  const { pushToast } = useApp();
  const [name, setName] = useState(bot.displayName);
  const [desc, setDesc] = useState(bot.description || '');
  const [copied, setCopied] = useState('');
  const copy = (t, what) => { navigator.clipboard?.writeText(t); setCopied(what); setTimeout(() => setCopied(''), 1500); };
  const patch = async (p) => { try { await api.updateBot(bot.id, p); reload(); } catch (e) { pushToast({ title: 'Error', body: e.message }); } };
  const dirty = name !== bot.displayName || desc !== (bot.description || '');

  return (
    <div className="dev-bot">
      <div className="dev-bot-head">
        <ImagePick className="dev-bot-av" onPicked={(url) => patch({ avatarUrl: url })}>
          <Avatar user={bot} size={64} /><span className="avatar-edit-overlay"><Icon name="camera" size={20} /></span>
        </ImagePick>
        <div className="dev-bot-meta">
          <input className="dev-bot-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
          <div className="dev-bot-id">
            ID <code>{bot.id}</code>
            <button className="link-btn" onClick={() => copy(bot.id, 'id')}>{copied === 'id' ? 'Copied!' : 'Copy'}</button>
          </div>
          <div className="muted small">In {bot.servers} server{bot.servers === 1 ? '' : 's'} · add it from Server Settings → Bots</div>
        </div>
      </div>
      <div className="st-label">Description <span className="muted small">(shown on its profile)</span></div>
      <textarea rows={2} value={desc} maxLength={400} onChange={(e) => setDesc(e.target.value)} />
      {dirty && <button className="btn-success sm" onClick={() => patch({ name, description: desc })}>Save</button>}

      <div className="st-label">Token</div>
      {reveal ? (
        <div className="dev-token">
          <code>{reveal}</code>
          <button className="btn-primary sm" onClick={() => copy(reveal, 'tok')}>{copied === 'tok' ? 'Copied!' : 'Copy'}</button>
          <div className="st-warn">Copy it now — for your safety it won’t be shown again. Anyone with this token can control your bot.</div>
        </div>
      ) : (
        <div className="st-btnrow">
          <span className="muted small">Hidden for security.</span>
          <button className="btn-ghost sm" onClick={async () => {
            if (!window.confirm(`Reset ${bot.displayName}'s token? The old one stops working immediately.`)) return;
            onToken((await api.resetBotToken(bot.id)).token);
          }}>Reset Token</button>
        </div>
      )}
      <div className="dev-bot-foot">
        <button className="btn-danger sm" onClick={async () => {
          if (!window.confirm(`Delete ${bot.displayName}? It will leave every server.`)) return;
          await api.deleteBot(bot.id); reload();
        }}>Delete Bot</button>
      </div>
    </div>
  );
}

// ---------------- Admin (global owner) ----------------
function AdminPage() {
  const { pushToast } = useApp();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState([]);
  const search = (text) => api.adminUsers(text).then((d) => setUsers(d.users)).catch((e) => pushToast({ title: 'Error', body: e.message }));
  useEffect(() => { search(''); }, []); // eslint-disable-line
  const save = async (u, patch) => {
    try { const { user } = await api.adminUpdateUser(u.id, patch); setUsers((l) => l.map((x) => (x.id === user.id ? user : x))); }
    catch (e) { pushToast({ title: 'Couldn’t update', body: e.message }); }
  };
  return (
    <>
      <h1>Admin</h1>
      <p className="st-hint">Owner-only tools. Give accounts the <span className="official-tag"><Icon name="check" size={10} stroke={3} /> OFFICIAL</span> tag or a custom #tag.</p>
      <form className="dev-new" onSubmit={(e) => { e.preventDefault(); search(q); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or name#tag" />
        <button className="btn-primary">Search</button>
      </form>
      {users.map((u) => <AdminRow key={u.id} u={u} save={save} />)}
    </>
  );
}
function AdminRow({ u, save }) {
  const [tag, setTag] = useState(u.tag);
  useEffect(() => setTag(u.tag), [u.tag]);
  return (
    <div className="admin-row">
      <Avatar user={u} size={36} />
      <div className="admin-meta">
        <div className="admin-name">{u.displayName}<span className="tag">#{u.tag}</span><UserTags user={u} /></div>
        <div className="muted small">{u.email || 'bot account'}</div>
      </div>
      <input className="admin-tag" value={tag} maxLength={4} onChange={(e) => setTag(e.target.value.replace(/\D/g, ''))} />
      {tag !== u.tag && <button className="btn-success sm" onClick={() => save(u, { tag })}>Set tag</button>}
      <label className="st-toggle small" title="Official tag">
        <span>Official</span>
        <input type="checkbox" checked={u.official} onChange={(e) => save(u, { official: e.target.checked })} />
        <i />
      </label>
    </div>
  );
}

// ======================= SERVER SETTINGS =======================
export function ServerSettings({ initialTab = 'overview', onClose }) {
  const { serverData, me } = useApp();
  const [tab, setTab] = useState(initialTab);
  if (!serverData) return null;
  const { server, isOwner } = serverData;
  const canDelete = isOwner || me.globalRank === 'owner';
  const sections = [
    { heading: server.name },
    { id: 'overview', label: 'Overview' },
    { id: 'invites', label: 'Invites' },
    { id: 'bots', label: 'Bots' },
    ...(canDelete ? [{ sep: true }, { id: 'delete', label: 'Delete Server', danger: true }] : []),
  ];
  return (
    <SettingsShell sections={sections} tab={tab} setTab={setTab} onClose={onClose}>
      {tab === 'overview' && <ServerOverview key={server.id} server={server} />}
      {tab === 'invites' && <ServerInvites server={server} />}
      {tab === 'bots' && <ServerBots />}
      {tab === 'delete' && <ServerDelete server={server} onDone={onClose} />}
    </SettingsShell>
  );
}

function ServerOverview({ server }) {
  const { pushToast, applyServerUpdate } = useApp();
  const initial = () => ({ name: server.name, iconUrl: server.iconUrl || null, iconColor: server.iconColor, description: server.description || '' });
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial());
  async function save() {
    setSaving(true);
    try { applyServerUpdate((await api.updateServer(server.id, { ...f, iconUrl: f.iconUrl || '' })).server); }
    catch (e) { pushToast({ title: 'Couldn’t save', body: e.message }); }
    setSaving(false);
  }
  return (
    <>
      <h1>Server Overview</h1>
      <div className="so-row">
        <div className="so-icon-col">
          <div className="so-icon" style={{ background: f.iconColor }}>
            {f.iconUrl ? <img src={assetUrl(f.iconUrl)} alt="" /> : (f.name || '?').slice(0, 2).toUpperCase()}
          </div>
          {f.iconUrl && <button className="link-btn" onClick={() => set('iconUrl')(null)}>Remove</button>}
        </div>
        <div className="so-icon-help">
          <div className="st-hint">We recommend an image of at least 512×512 for the server.</div>
          <ImagePick className="btn-ghost" onPicked={set('iconUrl')}>Upload Image</ImagePick>
        </div>
        <div className="so-name">
          <div className="st-label">Server Name</div>
          <input value={f.name} onChange={set('name')} maxLength={50} />
        </div>
      </div>
      <div className="st-divider" />
      <div className="st-label">Icon Colour <span className="muted small">(behind the initials when there’s no image)</span></div>
      <div className="color-row">
        {COLORS.map((c) => <button key={c} className={`swatch ${f.iconColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('iconColor')(c)} />)}
        <input type="color" className="swatch-custom" value={f.iconColor} onChange={set('iconColor')} title="Custom colour" />
      </div>
      <div className="st-label">Description</div>
      <textarea rows={3} value={f.description} onChange={set('description')} maxLength={300} placeholder="What’s this server about?" />
      <SaveBar dirty={dirty} saving={saving} onReset={() => setF(initial())} onSave={save} />
    </>
  );
}

function ServerInvites({ server }) {
  const { applyServerUpdate } = useApp();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h1>Invites</h1>
      <p className="st-hint">Friends join with this code using the compass button on the left. Making a new code stops the old one working.</p>
      <div className="invite-code-row">
        <code className="invite-code">{server.inviteCode}</code>
        <button className="btn-primary" onClick={() => { navigator.clipboard?.writeText(server.inviteCode); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied!' : 'Copy'}</button>
        <button className="btn-ghost" onClick={async () => applyServerUpdate((await api.newInvite(server.id)).server)}>New Code</button>
      </div>
    </>
  );
}

function ServerBots() {
  const { serverData, pushToast } = useApp();
  const [botId, setBotId] = useState('');
  const [mine, setMine] = useState([]);
  useEffect(() => { api.bots().then((d) => setMine(d.bots)).catch(() => {}); }, []);
  const inServer = serverData.members.filter((m) => m.bot);
  const add = async (id) => {
    try { await api.addBot(serverData.server.id, id.trim()); setBotId(''); }
    catch (e) { pushToast({ title: 'Couldn’t add bot', body: e.message }); }
  };
  return (
    <>
      <h1>Bots</h1>
      <p className="st-hint">Add a bot by its ID (the bot’s owner finds it in User Settings → Developer Portal).</p>
      <form className="dev-new" onSubmit={(e) => { e.preventDefault(); if (botId.trim()) add(botId); }}>
        <input value={botId} onChange={(e) => setBotId(e.target.value)} placeholder="Bot ID" />
        <button className="btn-primary" disabled={!botId.trim()}>Add Bot</button>
      </form>
      {mine.filter((b) => !inServer.some((m) => m.id === b.id)).length > 0 && (
        <>
          <div className="st-label">Your bots</div>
          {mine.filter((b) => !inServer.some((m) => m.id === b.id)).map((b) => (
            <div key={b.id} className="bot-row"><Avatar user={b} size={32} /><span>{b.displayName}</span><button className="btn-primary sm" onClick={() => add(b.id)}>Add</button></div>
          ))}
        </>
      )}
      <div className="st-label">In this server — {inServer.length}</div>
      {inServer.length === 0 && <div className="dev-empty">No bots yet.</div>}
      {inServer.map((b) => (
        <div key={b.id} className="bot-row">
          <Avatar user={b} size={32} /><span>{b.displayName}<span className="bot-tag"><Icon name="check" size={10} stroke={3} /> BOT</span></span>
          <button className="btn-danger sm" onClick={async () => { if (window.confirm(`Remove ${b.displayName}?`)) await api.removeMember(serverData.server.id, b.id); }}>Remove</button>
        </div>
      ))}
    </>
  );
}

function ServerDelete({ server, onDone }) {
  const { pushToast } = useApp();
  const [typed, setTyped] = useState('');
  return (
    <>
      <h1>Delete ‘{server.name}’</h1>
      <div className="st-warn big">This permanently deletes the server, every channel and every message. It can’t be undone.</div>
      <div className="st-label">Type the server name to confirm</div>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={server.name} />
      <div className="st-btnrow">
        <button className="btn-danger" disabled={typed !== server.name} onClick={async () => {
          try { await api.deleteServer(server.id); onDone(); } catch (e) { pushToast({ title: 'Couldn’t delete', body: e.message }); }
        }}>Delete Server</button>
      </div>
    </>
  );
}

// Mounted once in App: opens either settings screen from anywhere via the bus.
export default function SettingsLayer() {
  const [open, setOpen] = useState(null); // { kind:'user'|'server', tab }
  useEffect(() => bus.on('settings:open', (o) => setOpen({ kind: 'user', ...o })), []);
  useEffect(() => bus.on('server-settings:open', (o) => setOpen({ kind: 'server', ...o })), []);
  useEffect(() => bus.on('settings:close', () => setOpen(null)), []);
  if (!open) return null;
  const close = () => setOpen(null);
  return open.kind === 'server'
    ? <ServerSettings initialTab={open.tab} onClose={close} />
    : <UserSettings initialTab={open.tab} onClose={close} />;
}
