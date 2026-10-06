// Media embeds from message text — safely.
// People can paste a site's "embed code" (<iframe src=…>) or just a link. We
// NEVER render pasted HTML: we pull out the URL, check it against a list of
// trusted media hosts, and render our own sandboxed iframe for it. Anything
// else stays plain text.

// host → how to turn a URL into an embeddable player URL (null = not embeddable)
const PROVIDERS = [
  { name: 'Streamable', re: /^https?:\/\/(?:www\.)?streamable\.com\/(?:e\/|o\/|s\/)?([a-z0-9]+)/i, src: (m) => `https://streamable.com/e/${m[1]}` },
  { name: 'Vimeo', re: /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/i, src: (m) => `https://player.vimeo.com/video/${m[1]}` },
  { name: 'Medal', re: /^https?:\/\/(?:www\.)?medal\.tv\/(?:games\/[^/]+\/clips|clips|clip)\/([A-Za-z0-9_-]+)/i, src: (m) => `https://medal.tv/clip/${m[1]}?autoplay=0` },
  { name: 'Twitch', re: /^https?:\/\/(?:clips\.twitch\.tv\/(?:embed\?clip=)?|(?:www\.)?twitch\.tv\/[^/]+\/clip\/)([A-Za-z0-9_-]+)/i,
    src: (m) => `https://clips.twitch.tv/embed?clip=${m[1]}&parent=${location.hostname}` },
  { name: 'Spotify', re: /^https?:\/\/open\.spotify\.com\/(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/i,
    src: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: (m) => (m[1] === 'track' || m[1] === 'episode' ? 152 : 352) },
  { name: 'SoundCloud', re: /^https?:\/\/w\.soundcloud\.com\/player\/\?url=/i, src: (m) => m.input, height: () => 166 },
  { name: 'Google Drive', re: /^https?:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/i, src: (m) => `https://drive.google.com/file/d/${m[1]}/preview` },
  { name: 'Loom', re: /^https?:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/([a-f0-9]+)/i, src: (m) => `https://www.loom.com/embed/${m[1]}` },
  { name: 'Gfycat/Imgur', re: /^https?:\/\/(?:i\.)?imgur\.com\/([A-Za-z0-9]+)\.(?:gifv|mp4)/i, src: (m) => `https://imgur.com/${m[1]}/embed?pub=true`, kind: 'video' },
  { name: 'Figma', re: /^https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\//i, src: (m) => `https://www.figma.com/embed?embed_host=voxly&url=${encodeURIComponent(m.input)}` },
  { name: 'CodePen', re: /^https?:\/\/codepen\.io\/([^/]+)\/(?:pen|embed)\/([A-Za-z0-9]+)/i, src: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result` },
  // YouTube embed codes (plain YouTube links already get the click-to-play card)
  { name: 'YouTube', re: /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}`, youtube: true },
];

function resolve(url) {
  for (const p of PROVIDERS) {
    const m = p.re.exec(url);
    if (m) return { provider: p.name, src: p.src(m), height: p.height ? p.height(m) : null, url, youtube: !!p.youtube };
  }
  return null;
}

const IFRAME_BLOCK = /<div[^>]*>\s*<iframe[\s\S]*?<\/iframe>\s*<\/div>|<iframe[\s\S]*?(?:<\/iframe>|\/>)/gi;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;
const LINK = /https?:\/\/[^\s<>"']+/g;

// → { text: content with embed-code blocks removed, embeds: [{provider, src, height, url}] }
export function extractEmbeds(content = '') {
  const embeds = [];
  const seen = new Set();
  const add = (e) => { if (e && !seen.has(e.src)) { seen.add(e.src); embeds.push(e); } };
  let text = content;
  // 1) pasted <iframe> embed codes: keep only a trusted src, hide the HTML
  if (/<iframe/i.test(content)) {
    text = content.replace(IFRAME_BLOCK, (block) => {
      const m = SRC_ATTR.exec(block);
      const e = m && resolve(m[1].replace(/&amp;/g, '&').trim());
      if (e) { add(e); return ''; }
      return block; // untrusted host: leave it as visible text, never rendered
    }).trim();
  }
  // 2) bare links to supported hosts
  for (const url of text.match(LINK) || []) {
    const e = resolve(url.replace(/[).,!?]+$/, ''));
    if (e && !e.youtube) add(e);
  }
  return { text, embeds };
}
