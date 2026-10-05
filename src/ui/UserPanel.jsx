import { useApp } from '../state/AppContext.jsx';
import { Avatar, RankBadge, UserTags } from './common.jsx';
import { bus } from '../lib/bus.js';
import { openProfile } from './ProfileCard.jsx';
import Icon from './Icon.jsx';

export default function UserPanel() {
  const { me } = useApp();
  return (
    <div className="user-panel">
      <button className="user-panel-me" onClick={(e) => openProfile(e, me.id)} title="View your profile">
      <Avatar user={me} size={32} status="online" />
      <div className="user-panel-meta">
        <div className="user-panel-name">
          {me.displayName}
          <UserTags user={me} />
          {me.globalRankMeta && !me.official && <RankBadge rank={me.globalRankMeta} />}
        </div>
        <div className="user-panel-tag">{me.customStatus || `#${me.tag}`}</div>
      </div>
      </button>
      <button className="icon-btn" title="User Settings" onClick={() => bus.emit('settings:open', { tab: 'account' })}><Icon name="settings" size={19} /></button>
    </div>
  );
}
