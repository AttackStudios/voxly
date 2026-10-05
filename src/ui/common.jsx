import { assetUrl } from '../lib/api.js';
import Icon from './Icon.jsx';

export function Avatar({ user, size = 40, status }) {
  const initials = (user?.displayName || '?').slice(0, 2).toUpperCase();
  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      <div className="avatar" style={{ background: user?.avatarColor || '#5865F2', width: size, height: size, fontSize: size * 0.4 }}>
        {user?.avatarUrl ? <img className="avatar-img" src={assetUrl(user.avatarUrl)} alt={user.displayName} /> : initials}
      </div>
      {status && <span className={`status-dot status-${status}`} />}
    </div>
  );
}

export function RankBadge({ rank }) {
  if (!rank) return null;
  return (
    <span className="rank-badge" style={{ background: rank.color }}>{rank.label}</span>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
