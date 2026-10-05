// Detect YouTube video IDs and split text into clickable URL parts.
const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
const URL_RE = /(https?:\/\/[^\s<]+)/g;

export function extractYouTubeIds(text = '') {
  const ids = [];
  const seen = new Set();
  let m;
  YT_RE.lastIndex = 0;
  while ((m = YT_RE.exec(text))) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

// Returns an array of { text } and { url } parts so the renderer can make links.
export function linkifyParts(text = '') {
  const parts = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ url: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
