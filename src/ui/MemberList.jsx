import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Avatar, RankBadge, UserTags } from './common.jsx';
import { bus } from '../lib/bus.js';
import { openProfile } from './ProfileCard.jsx';
import Icon from './Icon.jsx';

export default function MemberList() {
  const { view, serverData, me, presence, setMemberRank, startDM } = useApp();
  const [menu, setMenu] = useState(null); // {member, x, y}
  if (view.type !== 'server' || !serverData) return null;

  const { members, myRank, isOwner } = serverData;
  const canManage = isOwner || ['admin', 'mod'].includes(myRank.key);

  // group: online vs offline, sorted by rank priority
  const withStatus = members.map((m) => ({ ...m, live: presence[m.id] || m.status || 'offline' }));
  const online = withStatus.filter((m) => m.live !== 'offline').sort(byRank);
  const offline = withStatus.filter((m) => m.live === 'offline').sort(byRank);

  function byRank(a, b) {
    const pa = (a.globalRankMeta?.priority || 0) + a.serverRank.priority;
    const pb = (b.globalRankMeta?.priority || 0) + b.serverRank.priority;
    return pb - pa;
  }

  function MemberRow(m) {
    return (
      <button key={m.id} className="member-row"
        onClick={(e) => openProfile(e, m.id, serverData.server.id)}
        onContextMenu={(e) => { e.preventDefault(); setMenu({ member: m, x: e.clientX, y: e.clientY }); }}>
        <Avatar user={m} size={32} status={m.live} />
        <div className="member-meta">
          <span className="member-name" style={{ color: m.globalRankMeta?.color || m.serverRank.color }}>
            {m.nickname || m.displayName}<UserTags user={m} />
          </span>
          {m.customStatus && <span className="member-status">{m.customStatus}</span>}
          <div className="member-badges">
            {m.globalRankMeta && <RankBadge rank={m.globalRankMeta} />}
            <span className="server-rank" style={{ color: m.serverRank.color }}>{m.serverRank.label}</span>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="member-list">
      <div className="member-cat">ONLINE — {online.length}</div>
      {online.map(MemberRow)}
      <div className="member-cat">OFFLINE — {offline.length}</div>
      {offline.map(MemberRow)}

      {menu && (
        <>
          <div className="ctx-backdrop" onClick={() => setMenu(null)} />
          <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }}>
            <div className="ctx-title">{menu.member.displayName}#{menu.member.tag}</div>
            {menu.member.id !== me.id && (
              <>
                <button className="ctx-item" onClick={async () => { await startDM([menu.member.id]); setMenu(null); }}><Icon name="message" size={16} /> Message</button>
                <button className="ctx-item" onClick={() => { bus.emit('call:start', { type: 'dm', targets: [menu.member], video: false, startDmWith: menu.member.id }); setMenu(null); }}><Icon name="phone" size={16} /> Call</button>
                <button className="ctx-item" onClick={() => { bus.emit('call:start', { type: 'dm', targets: [menu.member], video: true, startDmWith: menu.member.id }); setMenu(null); }}><Icon name="video" size={16} /> Video</button>
              </>
            )}
            {canManage && menu.member.id !== me.id && (
              <>
                <div className="ctx-sep" />
                <div className="ctx-label">Server rank</div>
                {['admin', 'mod', 'member'].map((r) => (
                  <button key={r} className={`ctx-item ${menu.member.serverRank.key === r ? 'on' : ''}`}
                    onClick={async () => { await setMemberRank(menu.member.id, r); setMenu(null); }}>
                    {r === 'admin' ? 'Admin' : r === 'mod' ? 'Moderator' : 'Member'}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
