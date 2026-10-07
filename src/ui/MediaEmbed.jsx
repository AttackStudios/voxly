import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { resolveEmbed } from '../lib/embeds.js';

// Player for a trusted media embed (see lib/embeds.js). Sandboxed so the
// embedded site can play video but can't navigate Voxly or reach its data.
export default function MediaEmbed({ e: initial }) {
  const [e, setE] = useState(initial);
  const [failed, setFailed] = useState(false);

  // short share links (vm.tiktok.com/…) are looked up by the server first
  useEffect(() => {
    if (!initial.needsResolve) return;
    let live = true;
    api.resolveLink(initial.url)
      .then(({ url }) => { const r = url && resolveEmbed(url); if (live) (r && r.src ? setE(r) : setFailed(true)); })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [initial]);

  if (failed) return null;
  if (!e.src) return <div className={`media-embed ${e.vertical ? 'vertical' : ''} loading`} />;
  const fixed = e.height != null;
  return (
    <div className={`media-embed ${fixed ? 'fixed' : ''} ${e.vertical ? 'vertical' : ''}`} style={fixed ? { height: e.height } : undefined}>
      <iframe
        src={e.src}
        title={`${e.provider} embed`}
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      />
      <a className="media-embed-src" href={e.url} target="_blank" rel="noreferrer">{e.provider}</a>
    </div>
  );
}
