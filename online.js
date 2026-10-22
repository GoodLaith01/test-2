// Free, legal online music sources. None of them needs an account or API key.
//  - Deezer: famous songs as 30-second previews (works on iPhone).
//  - iTunes Search: famous songs as 30-second previews (backup; Apple sends
//    iPhones to the Music app instead of answering, so it only works on computers).
//  - Audius: full songs that artists share for free, with no ads.

const APP_NAME = 'MyMusicPlayer';
let audiusBase = 'https://api.audius.co';

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Deezer's API doesn't allow direct browser requests, but supports JSONP.
let jsonpCount = 0;
function jsonp(url, signal, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const name = `__myMusicJsonp${Date.now()}${jsonpCount++}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      window[name] = () => { delete window[name]; }; // a late reply is ignored
      script.remove();
    };
    const onAbort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out')); }, timeoutMs);
    window[name] = (data) => {
      cleanup();
      delete window[name];
      if (data?.error) reject(new Error(data.error.message || 'Request failed'));
      else resolve(data);
    };
    script.onerror = () => { cleanup(); reject(new Error('Request failed')); };
    signal?.addEventListener('abort', onAbort);
    script.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${name}`;
    document.head.append(script);
  });
}

/* ---------- Deezer ---------- */

function fromDeezer(t) {
  return {
    id: `deezer:${t.id}`,
    source: 'deezer',
    remoteId: t.id,
    title: t.title || 'Untitled',
    artist: t.artist?.name || '',
    album: t.album?.title || '',
    duration: 30,
    fullDuration: t.duration || 0,
    artwork: t.album?.cover_medium || t.album?.cover_big || '',
    artworkLarge: t.album?.cover_xl || t.album?.cover_big || '',
    previewUrl: t.preview,
    link: t.link || '',
  };
}

export async function searchDeezer(query, signal) {
  const json = await jsonp(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=25`, signal);
  return (json.data || []).filter((t) => t.preview && t.readable !== false).map(fromDeezer);
}

/* ---------- iTunes ---------- */

export async function searchItunes(query, signal) {
  const json = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=25`,
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
      fullDuration: (r.trackTimeMillis || 0) / 1000,
      artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '300x300bb') : '',
      artworkLarge: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '1000x1000bb') : '',
      previewUrl: r.previewUrl,
      link: r.trackViewUrl || '',
    }));
}

// Famous songs: Deezer first; Apple as a backup when Deezer is unavailable.
export async function searchFamous(query, signal) {
  try {
    const songs = await searchDeezer(query, signal);
    if (songs.length) return songs;
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.warn('Deezer search failed', err);
  }
  return searchItunes(query, signal);
}

/* ---------- Audius ---------- */

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
    .filter((t) => t.is_streamable !== false && !t.stream_conditions && !t.is_stream_gated && !t.is_delete)
    .slice(0, 25)
    .map((t) => ({
      id: `audius:${t.id}`,
      source: 'audius',
      remoteId: t.id,
      title: t.title || 'Untitled',
      artist: t.user?.name || '',
      duration: t.duration || 0,
      artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
      artworkLarge: t.artwork?.['1000x1000'] || t.artwork?.['480x480'] || '',
      link: t.permalink ? `https://audius.co${t.permalink}` : '',
    }));
}

/* ---------- Playing ---------- */

// Deezer preview links expire after about 15 minutes; fetch a fresh one if needed.
function deezerLinkExpired(url) {
  const exp = Number(/exp=(\d+)/.exec(url || '')?.[1]);
  return !exp || exp * 1000 < Date.now() + 60_000;
}

export async function resolveStream(song) {
  if (song.source === 'audius') return `${audiusBase}/v1/tracks/${song.remoteId}/stream?app_name=${APP_NAME}`;
  if (song.source === 'deezer') {
    if (deezerLinkExpired(song.previewUrl)) {
      const track = await jsonp(`https://api.deezer.com/track/${song.remoteId}`);
      if (track?.preview) song.previewUrl = track.preview;
    }
    return song.previewUrl;
  }
  if (song.source === 'itunes') return song.previewUrl;
  return '';
}
