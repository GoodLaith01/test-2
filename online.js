// Free, legal online music sources. Neither needs an account or API key.
//  - Audius: full songs that artists share for free (no ads).
//  - iTunes Search: famous songs from Apple Music as 30-second previews.

const APP_NAME = 'MyMusicPlayer';
let audiusBase = 'https://api.audius.co';

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function audiusFetch(path, signal) {
  try {
    return await getJson(`${audiusBase}/v1${path}`, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // The main endpoint can be busy; ask it for the list of servers and pick one.
    const hosts = (await getJson('https://api.audius.co', signal)).data;
    if (!hosts?.length) throw err;
    audiusBase = hosts[Math.floor(Math.random() * hosts.length)];
    return getJson(`${audiusBase}/v1${path}`, signal);
  }
}

export async function searchAudius(query, signal) {
  const json = await audiusFetch(`/tracks/search?query=${encodeURIComponent(query)}&app_name=${APP_NAME}`, signal);
  return (json.data || [])
    .filter((t) => t.is_streamable !== false && !t.stream_conditions && !t.is_delete)
    .slice(0, 20)
    .map((t) => ({
      id: `audius:${t.id}`,
      source: 'audius',
      remoteId: t.id,
      title: t.title || 'Untitled',
      artist: t.user?.name || '',
      duration: t.duration || 0,
      artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
      link: t.permalink ? `https://audius.co${t.permalink}` : '',
    }));
}

export async function searchItunes(query, signal) {
  const json = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=20`,
    signal,
  );
  return (json.results || [])
    .filter((r) => r.previewUrl)
    .map((r) => ({
      id: `itunes:${r.trackId}`,
      source: 'itunes',
      title: r.trackName || 'Untitled',
      artist: r.artistName || '',
      album: r.collectionName || '',
      duration: 30,
      artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '300x300bb') : '',
      previewUrl: r.previewUrl,
      link: r.trackViewUrl || '',
    }));
}

export function streamUrl(song) {
  if (song.source === 'audius') return `${audiusBase}/v1/tracks/${song.remoteId}/stream?app_name=${APP_NAME}`;
  if (song.source === 'itunes') return song.previewUrl;
  return '';
}
