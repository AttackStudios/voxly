import { assetUrl } from '../lib/api.js';
import { renderMarkup } from '../lib/markup.jsx';

const hex = (n) => (Number.isInteger(n) ? `#${n.toString(16).padStart(6, '0')}` : null);

// Discord-style rich embed (what bots send): coloured bar, author, title,
// description, inline field grid, thumbnail, big image, footer + timestamp.
export default function Embed({ e, opts }) {
  const ts = e.timestamp ? new Date(e.timestamp) : null;
  return (
    <div className="embed" style={{ borderLeftColor: hex(e.color) || '#1e1f22' }}>
      <div className="embed-grid">
        <div className="embed-main">
          {e.author && (
            <div className="embed-author">
              {e.author.icon_url && <img src={assetUrl(e.author.icon_url)} alt="" />}
              <span>{e.author.name}</span>
            </div>
          )}
          {e.title && (
            <div className="embed-title">
              {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{renderMarkup(e.title, opts)}</a> : renderMarkup(e.title, opts)}
            </div>
          )}
          {e.description && <div className="embed-desc">{renderMarkup(e.description, opts)}</div>}
          {e.fields?.length > 0 && (
            <div className="embed-fields">
              {e.fields.map((f, i) => (
                <div key={i} className={`embed-field ${f.inline ? 'inline' : ''}`}>
                  <div className="embed-field-name">{renderMarkup(f.name, opts)}</div>
                  <div className="embed-field-value">{renderMarkup(f.value, opts)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {e.thumbnail && <img className="embed-thumb" src={assetUrl(e.thumbnail.url)} alt="" loading="lazy" />}
      </div>
      {e.image && (
        <a href={assetUrl(e.image.url)} target="_blank" rel="noreferrer">
          <img className="embed-image" src={assetUrl(e.image.url)} alt="" loading="lazy" />
        </a>
      )}
      {(e.footer || ts) && (
        <div className="embed-footer">
          {e.footer?.icon_url && <img src={assetUrl(e.footer.icon_url)} alt="" />}
          <span>{e.footer?.text}{e.footer && ts ? ' • ' : ''}{ts ? ts.toLocaleString() : ''}</span>
        </div>
      )}
    </div>
  );
}
