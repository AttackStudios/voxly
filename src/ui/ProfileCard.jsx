import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { api, assetUrl } from '../lib/api.js';
import { bus } from '../lib/bus.js';
import { directory } from '../lib/directory.js';
import { renderMarkup } from '../lib/markup.jsx';
import Icon from './Icon.jsx';
import { UserTags } from './common.jsx';

// Discord-style profile popout. Open from anywhere with
//   bus.emit('profile:open', { userId, x, y, serverId })
export function openProfile(e, userId, serverId) {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  bus.emit('profile:open', { userId, x: r.right, y: r.top, left: r.left, serverId });
}

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default function ProfileLayer() {
  const [req, setReq] = useState(null);
  useEffect(() => bus.on('profile:open', (r) => setReq(r)), []);
  useEffect(() => bus.on('profile:close', () => setReq(null)), []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e) => e.key === 'Escape' && setReq(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);
  if (!req) return null;
  return (
    <>
      <div className="pc-backdrop" onMouseDown={() => setReq(null)} />
      <ProfileCard key={req.userId} req={req} onClose={() => setReq(null)} />
    </>
  );
}

export function ProfileCard({ req, onClose, preview }) {
  const { me, presence, startDM, socket } = useApp();
  const [data, setData] = useState(() => (preview ? { user: preview } : { user: directory.user(req.userId) }));
  const [tab, setTab] = useState('about');
  const [msg, setMsg] = useState('');
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });

  useEffect(() => {
    if (preview) { setData({ user: preview }); return; }
    api.profile(req.userId, req.serverId).then((d) => { setData(d); directory.putUsers([d.user]); }).catch(() => {});
  }, [req?.userId, req?.serverId, preview]);

  // place next to the click, kept fully on screen
  useLayoutEffect(() => {
    if (preview || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const pad = 12;
    let left = (req.x ?? 0) + 12;
    if (left + width > window.innerWidth - pad) left = Math.max(pad, (req.left ?? req.x ?? 0) - width - 12);
    const top = Math.min(Math.max(pad, req.y ?? pad), window.innerHeight - height - pad);
    setPos({ left, top: Math.max(pad, top) });
  }, [data, req, preview]);

  const u = data?.user;
  if (!u) return null;
  const isMe = u.id === me.id;
  const status = isMe ? 'online' : presence[u.id] || u.status || 'offline';
  const banner = u.bannerUrl
    ? { backgroundImage: `url(${assetUrl(u.bannerUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: u.bannerColor || u.avatarColor || '#5865F2' };
  const member = data.member;
  const tabs = [['about', u.bot ? 'About' : 'About Me'], ...(!isMe && !preview ? [['servers', 'Mutual Servers']] : [])];

  async function sendDm(e) {
    e.preventDefault();
    const t = msg.trim();
    if (!t) return;
    const convo = await startDM([u.id]);
    socket.current?.emit('message:send', { dmId: convo.id, content: t });
    onClose?.();
  }

  return (
    <div className={`pc ${preview ? 'preview' : ''}`} ref={ref} style={preview ? undefined : pos} onMouseDown={(e) => e.stopPropagation()}>
      <div className="pc-banner" style={banner} />
      <div className="pc-head">
        <div className="pc-avatar" style={{ background: u.avatarColor }}>
          {u.avatarUrl ? <img src={assetUrl(u.avatarUrl)} alt="" /> : u.displayName.slice(0, 2).toUpperCase()}
          <span className={`pc-status status-${status}`} title={status} />
        </div>
        {isMe && !preview && (
          <button className="pc-edit" onClick={() => { onClose?.(); bus.emit('settings:open', { tab: 'profile' }); }}><Icon name="edit" size={14} /> Edit Profile</button>
        )}
      </div>
      <div className="pc-body">
        <div className="pc-names">
          <div className="pc-display">{member?.nickname || u.displayName}<UserTags user={u} /></div>
          <div className="pc-user">
            {u.displayName.toLowerCase().replace(/\s+/g, '')}{!u.bot && <span className="pc-tag">#{u.tag}</span>}
            {u.pronouns && <><span className="pc-dot">•</span>{u.pronouns}</>}
          </div>
          {(u.globalRankMeta || member?.isOwner) && (
            <div className="pc-badges">
              {member?.isOwner && <span className="pc-badge" title="Server Owner"><Icon name="crown" size={13} style={{ color: '#f0b232' }} /> Server Owner</span>}
              {u.globalRankMeta && <span className="pc-badge" style={{ color: u.globalRankMeta.color }} title={`Voxly ${u.globalRankMeta.label}`}><Icon name="star" size={13} /> {u.globalRankMeta.label}</span>}
            </div>
          )}
          {u.customStatus && <div className="pc-custom"><Icon name="message" size={14} /> {u.customStatus}</div>}
        </div>

        <div className="pc-inner">
          <div className="pc-tabs">
            {tabs.map(([id, label]) => (
              <button key={id} className={`pc-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'about' && (
            <div className="pc-section-wrap">
              {(u.bot ? data.bot?.description : u.aboutMe) && (
                <div className="pc-about">{renderMarkup(u.bot ? data.bot.description : u.aboutMe, { meId: me.id })}</div>
              )}
              {u.bot && data.bot?.owner && <div className="pc-small">Made by <b>{data.bot.owner.displayName}</b></div>}
              <div className="pc-label">Member Since</div>
              <div className="pc-since">
                <span title="Joined Voxly"><img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" /> {fmtDate(u.createdAt)}</span>
                {member?.joinedAt && <><span className="pc-dot">•</span><span title="Joined this server"><Icon name="home" size={14} /> {fmtDate(member.joinedAt)}</span></>}
              </div>
              {member && (
                <>
                  <div className="pc-label">Roles</div>
                  <div className="pc-roles">
                    <span className="pc-role"><i style={{ background: member.serverRank.color }} />{member.serverRank.label}</span>
                    {u.globalRankMeta && <span className="pc-role"><i style={{ background: u.globalRankMeta.color }} />{u.globalRankMeta.label}</span>}
                  </div>
                </>
              )}
            </div>
          )}
          {tab === 'servers' && (
            <div className="pc-section-wrap">
              {(data.mutualServers || []).length === 0 && <div className="pc-small">No servers in common.</div>}
              {(data.mutualServers || []).map((s) => (
                <div key={s.id} className="pc-mutual">
                  <span className="pc-mutual-icon" style={{ background: s.iconColor }}>
                    {s.iconUrl ? <img src={assetUrl(s.iconUrl)} alt="" /> : s.name.slice(0, 2).toUpperCase()}
                  </span>
                  {s.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {!isMe && !preview && (
          <form onSubmit={sendDm}>
            <input className="pc-msg" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`Message @${u.displayName}`} />
          </form>
        )}
      </div>
    </div>
  );
}
