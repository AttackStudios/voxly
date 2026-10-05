// Discord-style message markup → React nodes.
// Supports: ```code blocks```, `inline code`, **bold**, *italic* / _italic_,
// __underline__, ~~strike~~, ||spoilers||, > quotes, # headings, links,
// <@userId> / @Name mentions, <#channelId>, and <t:unix[:style]> timestamps.
import { useState } from 'react';
import { directory } from './directory.js';
import { bus } from './bus.js';

const norm = (s) => s.replace(/[\s.]+/g, '').toLowerCase();

function fmtTime(sec, style = 'f') {
  const d = new Date(sec * 1000);
  const diff = (d - Date.now()) / 1000;
  switch (style) {
    case 't': return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    case 'T': return d.toLocaleTimeString();
    case 'd': return d.toLocaleDateString();
    case 'D': return d.toLocaleDateString([], { dateStyle: 'long' });
    case 'F': return d.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' });
    case 'R': {
      const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
      const a = Math.abs(diff);
      if (a < 60) return rtf.format(Math.round(diff), 'second');
      if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (a < 2592000) return rtf.format(Math.round(diff / 86400), 'day');
      if (a < 31536000) return rtf.format(Math.round(diff / 2592000), 'month');
      return rtf.format(Math.round(diff / 31536000), 'year');
    }
    default: return d.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  }
}

function Spoiler({ children }) {
  const [open, setOpen] = useState(false);
  return <span className={`md-spoiler ${open ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{children}</span>;
}

// inline rules, tried in order at each position (earliest match wins)
const INLINE = [
  { re: /`([^`\n]+)`/, node: (m, k) => <code key={k} className="md-code">{m[1]}</code> },
  { re: /<@!?([0-9a-f-]{36})>/, node: (m, k, o) => {
    const u = directory.user(m[1]);
    return <span key={k} className={`mention ${m[1] === o.meId ? 'me' : ''}`}
      onClick={(e) => { e.stopPropagation(); bus.emit('profile:open', { userId: m[1], x: e.clientX, y: e.clientY, serverId: o.serverId }); }}>
      @{u?.displayName || 'unknown-user'}</span>;
  } },
  { re: /<#([0-9a-f-]{36})>/, node: (m, k) => {
    const c = directory.channel(m[1]);
    return <span key={k} className="mention channel" onClick={() => c && bus.emit('channel:open', c)}>#{c?.name || 'unknown-channel'}</span>;
  } },
  { re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/, node: (m, k) => (
    <span key={k} className="md-time" title={new Date(+m[1] * 1000).toLocaleString()}>{fmtTime(+m[1], m[2])}</span>
  ) },
  { re: /(https?:\/\/[^\s<]+[^\s<.,:;"')\]])/, node: (m, k) => <a key={k} href={m[1]} target="_blank" rel="noreferrer" className="msg-link">{m[1]}</a> },
  { re: /\|\|([\s\S]+?)\|\|/, node: (m, k, o) => <Spoiler key={k}>{inline(m[1], o)}</Spoiler> },
  { re: /\*\*([\s\S]+?)\*\*/, node: (m, k, o) => <strong key={k}>{inline(m[1], o)}</strong> },
  { re: /__([\s\S]+?)__/, node: (m, k, o) => <u key={k}>{inline(m[1], o)}</u> },
  { re: /~~([\s\S]+?)~~/, node: (m, k, o) => <s key={k}>{inline(m[1], o)}</s> },
  { re: /\*([^*\s][^*]*?)\*/, node: (m, k, o) => <em key={k}>{inline(m[1], o)}</em> },
  { re: /(?<![\w])_([^_\s][^_]*?)_(?![\w])/, node: (m, k, o) => <em key={k}>{inline(m[1], o)}</em> },
  { re: /@(everyone|here|[\w.]+)/, node: (m, k, o) => {
    const isMe = /^(everyone|here)$/i.test(m[1]) || (o.meName && norm(m[1]) === norm(o.meName));
    const known = /^(everyone|here)$/i.test(m[1]) || (o.mentionNames || []).some((n) => norm(n) === norm(m[1]));
    return known ? <span key={k} className={`mention ${isMe ? 'me' : ''}`}>@{m[1]}</span> : <span key={k}>@{m[1]}</span>;
  } },
];

function inline(text, o, depth = 0) {
  if (!text) return null;
  if (depth > 8) return text;
  const out = [];
  let rest = text, key = 0;
  while (rest) {
    let best = null;
    for (const r of INLINE) {
      const m = r.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, r };
    }
    if (!best) { out.push(rest); break; }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.r.node(best.m, `${depth}-${key++}`, o));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// Block level: code fences, quotes, headings; everything else is inline.
export function renderMarkup(text, opts = {}) {
  if (!text) return null;
  const blocks = [];
  const parts = text.split(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/i);
  parts.forEach((part, i) => {
    if (i % 2 === 1) { blocks.push(<pre key={`c${i}`} className="md-pre"><code>{part.replace(/\n$/, '')}</code></pre>); return; }
    if (!part) return;
    const lines = part.split('\n');
    let quote = [];
    const flushQuote = (k) => {
      if (!quote.length) return;
      blocks.push(<blockquote key={`q${i}-${k}`} className="md-quote">{quote.map((l, j) => <div key={j}>{inline(l, opts) || ' '}</div>)}</blockquote>);
      quote = [];
    };
    lines.forEach((line, j) => {
      const q = /^>\s?(.*)$/.exec(line);
      if (q) { quote.push(q[1]); return; }
      flushQuote(j);
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) { blocks.push(<div key={`h${i}-${j}`} className={`md-h${h[1].length}`}>{inline(h[2], opts)}</div>); return; }
      blocks.push(<span key={`l${i}-${j}`}>{inline(line, opts)}{j < lines.length - 1 ? '\n' : ''}</span>);
    });
    flushQuote('end');
  });
  return blocks;
}
