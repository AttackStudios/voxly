import { useState } from 'react';

// Shows a YouTube thumbnail; click to play inline (privacy-friendly nocookie embed).
export default function YouTubeEmbed({ id }) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    return (
      <div className="yt-embed playing">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title="YouTube video"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <button className="yt-embed" onClick={() => setPlaying(true)} title="Play video">
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="YouTube thumbnail" loading="lazy" />
      <span className="yt-play">▶</span>
      <span className="yt-badge">YouTube</span>
    </button>
  );
}
