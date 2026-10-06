// Player for a trusted media embed (see lib/embeds.js). Sandboxed so the
// embedded site can play video but can't navigate Voxly or reach its data.
export default function MediaEmbed({ e }) {
  const fixed = e.height != null;
  return (
    <div className={`media-embed ${fixed ? 'fixed' : ''}`} style={fixed ? { height: e.height } : undefined}>
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
