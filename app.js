import { getAllSongs, addSong, updateSong, deleteSong, getSongBlob } from './db.js';
import { searchAudius, searchItunes, streamUrl } from './online.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  fileInput: $('#file-input'),
  views: document.querySelectorAll('.view'),
  navBtns: document.querySelectorAll('.nav-btn'),
  libraryList: $('[data-list="library"]'),
  librarySummary: $('#library-summary'),
  libraryEmpty: $('#library-empty'),
  likedList: $('[data-list="liked"]'),
  likedSummary: $('#liked-summary'),
  likedEmpty: $('#liked-empty'),
  playLiked: $('#play-liked'),
  search: $('#search'),
  chips: document.querySelectorAll('.chip'),
  searchResults: $('#search-results'),
  player: $('#player'),
  audio: $('#audio'),
  play: $('#play'),
  prev: $('#prev'),
  next: $('#next'),
  shuffle: $('#shuffle'),
  repeat: $('#repeat'),
  seek: $('#seek'),
  timeCurrent: $('#time-current'),
  timeTotal: $('#time-total'),
  volume: $('#volume'),
  mute: $('#mute'),
  npArt: $('#np-art'),
  npTitle: $('#np-title'),
  npArtist: $('#np-artist'),
  npFav: $('#np-fav'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
  editDialog: $('#edit-dialog'),
  editForm: $('#edit-form'),
};

const REPEAT_MODES = ['off', 'all', 'one'];

const SOURCES = {
  local: { label: 'My songs' },
  audius: { label: 'Audius', open: 'Open on Audius' },
  itunes: { label: 'Apple Music', open: 'Open in Apple Music' },
};

const state = {
  songs: [],            // saved in IndexedDB: songs added from this device + liked online songs
  catalog: new Map(),   // every song we know about (saved + search results), by id
  lists: {},            // ids shown in each list; clicking a song plays that list in order
  view: 'library',
  search: { query: '', filter: 'all', loading: false, results: { audius: [], itunes: [] }, errors: {} },
  queue: [],
  history: [],
  currentId: null,
  objectUrl: null,
  shuffle: false,
  repeat: 'off',
  seeking: false,
};

const isLocal = (song) => !song.source || song.source === 'local';

/* ---------- Settings (per device, best effort) ---------- */

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-music-settings') || '{}');
    state.shuffle = !!saved.shuffle;
    state.repeat = REPEAT_MODES.includes(saved.repeat) ? saved.repeat : 'off';
    if (typeof saved.volume === 'number') els.audio.volume = saved.volume;
    if (['library', 'liked', 'search'].includes(saved.view)) state.view = saved.view;
  } catch { /* storage unavailable: use defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem('my-music-settings', JSON.stringify({
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: els.audio.volume,
      view: state.view,
    }));
  } catch { /* ignore */ }
}

/* ---------- Helpers ---------- */

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// "Artist - Title.mp3" -> { artist, title }
function parseFileName(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() || base };
  }
  return { artist: '', title: base || name };
}

function readDuration(blob) {
  return new Promise((resolve, reject) => {
    const probe = new Audio();
    const url = URL.createObjectURL(blob);
    const finish = (fn, value) => {
      clearTimeout(timer);
      probe.removeAttribute('src');
      URL.revokeObjectURL(url);
      fn(value);
    };
    const timer = setTimeout(() => finish(resolve, 0), 10000);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(resolve, Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(reject, new Error('unsupported'));
    probe.src = url;
  });
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3500);
}

function setRangeFill(input) {
  const max = Number(input.max) || 0;
  const pct = max ? (Number(input.value) / max) * 100 : 0;
  input.style.setProperty('--pct', `${pct}%`);
}

function songById(id) {
  return state.catalog.get(id);
}

// Use the saved copy of a song when we have one, so likes show up in search results.
function adopt(song) {
  const known = state.catalog.get(song.id);
  if (known) return known;
  state.catalog.set(song.id, song);
  return song;
}

/* ---------- Rendering ---------- */

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
const NOTE = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
const EQ = '<span class="eq"><i></i><i></i><i></i></span>';

function rowHtml(s, i) {
  const isCurrent = s.id === state.currentId;
  const paused = isCurrent && els.audio.paused;
  const art = s.artwork
    ? `<img class="thumb" src="${escapeHtml(s.artwork)}" alt="" loading="lazy">`
    : `<span class="thumb">${NOTE}</span>`;
  const badge = s.source === 'itunes' ? '<span class="badge">Preview</span>'
    : s.source === 'audius' ? '<span class="badge badge-free">Free</span>' : '';
  return `
    <li class="song${isCurrent ? ' playing' : ''}${paused ? ' paused' : ''}" data-id="${escapeHtml(s.id)}">
      <span class="song-index">${isCurrent ? EQ : i + 1}</span>
      ${art}
      <div class="song-main">
        <div class="song-title">${escapeHtml(s.title)}</div>
        <div class="song-artist">${badge}${escapeHtml(s.artist || 'Unknown artist')}</div>
      </div>
      <button class="icon-btn fav-btn${s.favorite ? ' on' : ''}" data-action="fav"
        aria-label="${s.favorite ? 'Remove from' : 'Add to'} Liked Songs">${HEART}</button>
      <span class="song-duration">${formatTime(s.duration)}</span>
      <div class="song-menu">
        <button class="icon-btn" data-action="menu" aria-label="More options">${DOTS}</button>
      </div>
    </li>`;
}

function fillList(listEl, songs) {
  state.lists[listEl.dataset.list] = songs.map((s) => s.id);
  listEl.innerHTML = songs.map(rowHtml).join('');
}

function summaryText(songs) {
  const total = songs.reduce((t, s) => t + (s.duration || 0), 0);
  return `${songs.length} song${songs.length === 1 ? '' : 's'}${songs.length ? ` · ${formatTime(total)}` : ''}`;
}

function librarySongs() {
  return state.songs.filter(isLocal).sort((a, b) => b.addedAt - a.addedAt);
}

function likedSongs() {
  return state.songs
    .filter((s) => s.favorite)
    .sort((a, b) => (b.likedAt || b.addedAt) - (a.likedAt || a.addedAt));
}

function localMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return librarySongs().filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
}

function renderLibrary() {
  const songs = librarySongs();
  fillList(els.libraryList, songs);
  els.librarySummary.textContent = summaryText(songs);
  els.librarySummary.hidden = !songs.length;
  els.libraryEmpty.hidden = songs.length > 0;
}

function renderLiked() {
  const songs = likedSongs();
  fillList(els.likedList, songs);
  els.likedSummary.textContent = summaryText(songs);
  els.likedEmpty.hidden = songs.length > 0;
  els.playLiked.hidden = !songs.length;
}

const SECTIONS = [
  { key: 'local', title: 'From My Songs', note: '' },
  { key: 'audius', title: 'Full songs — free, no ads', note: 'From Audius, where artists share their music for free.' },
  { key: 'itunes', title: 'Famous hits — 30-second previews', note: 'From Apple Music. Full versions of famous songs need a music subscription.' },
];

function renderSearch() {
  const { query, filter, loading, results, errors } = state.search;
  const q = query.trim();

  if (!q) {
    els.searchResults.innerHTML = `
      <div class="search-hint">
        <h3>Find something to listen to</h3>
        <p>Type a song, artist or genre — for example <em>lofi</em>, <em>piano</em> or <em>Adele</em>.</p>
        <ul>
          <li><span class="badge badge-free">Free</span> <strong>Full songs</strong> — free and with no ads, from artists who share their music on Audius.</li>
          <li><span class="badge">Preview</span> <strong>Famous hits</strong> — 30-second previews from Apple Music.</li>
          <li>Songs you added to <strong>My Songs</strong>.</li>
        </ul>
        <p>Tap ♡ on any song to save it to <strong>Liked Songs</strong>.</p>
      </div>`;
    return;
  }

  const songsFor = { local: localMatches(q), audius: results.audius, itunes: results.itunes };
  const html = SECTIONS
    .filter(({ key }) => filter === 'all' || filter === key)
    .map(({ key, title, note }) => {
      const songs = songsFor[key];
      let body;
      if (key !== 'local' && loading) body = '<p class="section-status">Searching…</p>';
      else if (key !== 'local' && errors[key]) body = `<p class="section-status">${escapeHtml(errors[key])}</p>`;
      else if (!songs.length) {
        if (filter === 'all' && key === 'local') return '';
        body = '<p class="section-status">No results.</p>';
      } else body = `<ol class="song-list" data-list="search-${key}"></ol>`;
      return `
        <section class="result-section">
          <h3>${title}</h3>
          ${note ? `<p class="section-note">${note}</p>` : ''}
          ${body}
        </section>`;
    }).join('');

  els.searchResults.innerHTML = html;
  for (const { key } of SECTIONS) {
    const list = els.searchResults.querySelector(`[data-list="search-${key}"]`);
    if (list) fillList(list, songsFor[key]);
  }
}

function render() {
  els.views.forEach((v) => { v.hidden = v.dataset.view !== state.view; });
  els.navBtns.forEach((b) => {
    const active = b.dataset.goto === state.view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (state.view === 'library') renderLibrary();
  if (state.view === 'liked') renderLiked();
  if (state.view === 'search') renderSearch();
}

function goTo(view) {
  if (state.view === view) return;
  state.view = view;
  closeMenus();
  render();
  saveSettings();
  window.scrollTo(0, 0);
  if (view === 'search' && matchMedia('(hover: hover)').matches) els.search.focus();
}

/* ---------- Adding, liking, editing, deleting ---------- */

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus|oga|webm)$/i.test(f.name));
  if (!files.length) {
    toast('No audio files found.');
    return;
  }

  let added = 0;
  const failed = [];
  toast(`Adding ${files.length} song${files.length === 1 ? '' : 's'}…`);
  if (state.view !== 'library') goTo('library');

  for (const file of files) {
    try {
      // Copy the bytes so the song doesn't depend on the original file staying available.
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
      const duration = await readDuration(blob);
      const { artist, title } = parseFileName(file.name);
      const song = {
        id: newId(),
        source: 'local',
        title,
        artist,
        duration,
        type: blob.type,
        size: blob.size,
        fileName: file.name,
        favorite: false,
        addedAt: Date.now() + added, // keeps the picked order stable
      };
      await addSong(song, blob);
      state.songs.push(song);
      state.catalog.set(song.id, song);
      added++;
      render();
    } catch (err) {
      console.error('Could not add', file.name, err);
      failed.push(file.name);
    }
  }

  if (added) navigator.storage?.persist?.().catch(() => {});

  if (failed.length) {
    toast(`Added ${added}. Couldn't add ${failed.length} (format not supported or storage full): ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
  } else {
    toast(`Added ${added} song${added === 1 ? '' : 's'}.`);
  }
}

async function toggleFavorite(id) {
  const song = songById(id);
  if (!song) return;
  song.favorite = !song.favorite;
  song.likedAt = song.favorite ? Date.now() : undefined;

  try {
    if (isLocal(song)) {
      await updateSong(song);
    } else if (song.favorite) {
      // Online songs are only saved while they're liked.
      song.addedAt ??= Date.now();
      await updateSong(song);
      if (!state.songs.includes(song)) state.songs.push(song);
    } else {
      await deleteSong(song.id);
      state.songs = state.songs.filter((s) => s.id !== id);
    }
  } catch (err) {
    console.error(err);
    song.favorite = !song.favorite;
    toast('Couldn’t save that. Storage may be full or blocked.');
    return;
  }

  toast(song.favorite ? 'Added to Liked Songs.' : 'Removed from Liked Songs.');
  render();
  updateNowPlaying();
}

async function removeSong(id) {
  const song = songById(id);
  if (!song || !confirm(`Delete “${song.title}” from this device?`)) return;
  if (id === state.currentId) stop();
  await deleteSong(id);
  state.songs = state.songs.filter((s) => s.id !== id);
  state.catalog.delete(id);
  state.queue = state.queue.filter((q) => q !== id);
  state.history = state.history.filter((h) => h !== id);
  render();
  toast('Song deleted.');
}

function editSong(id) {
  const song = songById(id);
  if (!song) return;
  els.editForm.elements.title.value = song.title;
  els.editForm.elements.artist.value = song.artist;
  els.editDialog.dataset.id = id;
  els.editDialog.showModal();
}

els.editDialog.addEventListener('close', async () => {
  if (els.editDialog.returnValue !== 'save') return;
  const song = songById(els.editDialog.dataset.id);
  if (!song) return;
  song.title = els.editForm.elements.title.value.trim() || song.title;
  song.artist = els.editForm.elements.artist.value.trim();
  await updateSong(song);
  render();
  updateNowPlaying();
});

/* ---------- Song menu ---------- */

function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
}

function openMenu(button, id) {
  closeMenus();
  const song = songById(id);
  if (!song) return;
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = isLocal(song)
    ? `<button data-action="edit">Edit details</button>
       <button data-action="delete" class="danger">Delete from device</button>`
    : `<button data-action="like">${song.favorite ? 'Remove from' : 'Save to'} Liked Songs</button>
       ${song.link ? `<a href="${escapeHtml(song.link)}" target="_blank" rel="noopener">${SOURCES[song.source].open} ↗</a>` : ''}`;
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('a')) {
      setTimeout(closeMenus); // let the link open first
      return;
    }
    const action = e.target.closest('button')?.dataset.action;
    closeMenus();
    if (action === 'edit') editSong(id);
    if (action === 'delete') removeSong(id);
    if (action === 'like') toggleFavorite(id);
  });
  button.parentElement.append(menu);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.song-menu')) closeMenus();
  const goto = e.target.closest('[data-goto]');
  if (goto) goTo(goto.dataset.goto);
});

document.querySelector('main').addEventListener('click', (e) => {
  const row = e.target.closest('.song');
  if (!row || e.target.closest('.menu')) return;
  const id = row.dataset.id;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'fav') return toggleFavorite(id);
  if (action === 'menu') return openMenu(e.target.closest('button'), id);

  if (id === state.currentId) {
    togglePlay();
  } else {
    playSong(id, state.lists[row.closest('[data-list]').dataset.list] || [id]);
  }
});

/* ---------- Playback ---------- */

async function playSong(id, queue = state.queue, { fromHistory = false } = {}) {
  const song = songById(id);
  if (!song) return;

  let src;
  if (isLocal(song)) {
    const blob = await getSongBlob(id);
    if (!blob) {
      toast('This song’s file is missing. Try deleting and re-adding it.');
      return;
    }
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(blob);
    src = state.objectUrl;
  } else {
    if (!navigator.onLine) toast('You’re offline. Online songs need an internet connection.');
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    src = streamUrl(song);
  }

  if (!fromHistory && state.currentId && state.currentId !== id) state.history.push(state.currentId);
  if (state.history.length > 200) state.history.shift();

  state.queue = queue;
  state.currentId = id;
  els.audio.src = src;

  try {
    await els.audio.play();
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      toast('Couldn’t play this song.');
    }
  }
  updateNowPlaying();
  render();
}

function playList(ids) {
  if (!ids.length) return;
  const first = state.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
  return playSong(first, ids);
}

function togglePlay() {
  if (!state.currentId) {
    const ids = state.view === 'search'
      ? Object.entries(state.lists).find(([k, v]) => k.startsWith('search-') && v.length && els.searchResults.querySelector(`[data-list="${k}"]`))?.[1] || []
      : state.lists[state.view] || [];
    return playList(ids);
  }
  if (els.audio.paused) {
    els.audio.play().catch(() => {});
  } else {
    els.audio.pause();
  }
}

function stop() {
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.currentId = null;
  updateNowPlaying();
}

function pickNextId({ auto }) {
  const queue = state.queue.filter((id) => songById(id));
  if (!queue.length) return null;

  if (auto && state.repeat === 'one') return state.currentId;

  if (state.shuffle) {
    if (queue.length === 1) return state.repeat !== 'off' || !auto ? queue[0] : null;
    const options = queue.filter((id) => id !== state.currentId);
    return options[Math.floor(Math.random() * options.length)];
  }

  const i = queue.indexOf(state.currentId);
  if (i === -1) return queue[0];
  if (i < queue.length - 1) return queue[i + 1];
  return state.repeat === 'all' ? queue[0] : null;
}

function playNext({ auto = false } = {}) {
  const id = pickNextId({ auto });
  if (id === null) {
    if (auto) {
      els.audio.currentTime = 0;
      updateNowPlaying();
      render();
    }
    return;
  }
  if (id === state.currentId) {
    els.audio.currentTime = 0;
    els.audio.play().catch(() => {});
    return;
  }
  playSong(id);
}

function playPrev() {
  if (els.audio.currentTime > 3 || !state.currentId) {
    els.audio.currentTime = 0;
    return;
  }
  if (state.shuffle) {
    while (state.history.length) {
      const id = state.history.pop();
      if (songById(id)) return playSong(id, state.queue, { fromHistory: true });
    }
    els.audio.currentTime = 0;
    return;
  }
  const queue = state.queue.filter((id) => songById(id));
  const i = queue.indexOf(state.currentId);
  if (i > 0) return playSong(queue[i - 1]);
  if (state.repeat === 'all' && queue.length) return playSong(queue[queue.length - 1]);
  els.audio.currentTime = 0;
}

function updateNowPlaying() {
  const song = songById(state.currentId);
  els.npTitle.textContent = song ? song.title : 'Nothing playing';
  els.npArtist.textContent = song
    ? `${song.artist || 'Unknown artist'}${song.source === 'itunes' ? ' · 30-sec preview' : ''}`
    : 'Pick a song to start';
  if (song?.artwork) {
    if (els.npArt.getAttribute('src') !== song.artwork) els.npArt.src = song.artwork;
    els.npArt.hidden = false;
  } else {
    els.npArt.hidden = true;
    els.npArt.removeAttribute('src');
  }
  els.npFav.hidden = !song;
  els.npFav.classList.toggle('on', !!song?.favorite);
  els.npFav.setAttribute('aria-label', song?.favorite ? 'Remove from Liked Songs' : 'Add to Liked Songs');
  document.title = song && !els.audio.paused ? `${song.title} · My Music` : 'My Music';

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = song
      ? new MediaMetadata({
          title: song.title,
          artist: song.artist || 'Unknown artist',
          album: song.album || 'My Music',
          artwork: song.artwork
            ? [{ src: song.artwork, sizes: '480x480' }]
            : [
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
              ],
        })
      : null;
  }
}

function updatePlayState() {
  const playing = !els.audio.paused && !!state.currentId;
  els.player.classList.toggle('is-playing', playing);
  els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  updateNowPlaying();
  // Only the playing row and its neighbours change; avoid re-rendering search while typing.
  document.querySelectorAll('.song').forEach((row) => {
    const isCurrent = row.dataset.id === state.currentId;
    row.classList.toggle('playing', isCurrent);
    row.classList.toggle('paused', isCurrent && !playing);
  });
}

function updateModeButtons() {
  els.shuffle.setAttribute('aria-pressed', String(state.shuffle));
  els.repeat.dataset.mode = state.repeat;
  els.repeat.setAttribute('aria-label', `Repeat: ${state.repeat}`);
}

/* ---------- Search ---------- */

let searchTimer;
let searchCtrl;

async function runOnlineSearch() {
  const q = state.search.query.trim();
  searchCtrl?.abort();
  if (q.length < 2) {
    state.search.loading = false;
    state.search.results = { audius: [], itunes: [] };
    state.search.errors = {};
    renderSearch();
    return;
  }

  const ctrl = new AbortController();
  searchCtrl = ctrl;
  state.search.loading = true;
  renderSearch();

  const [audius, itunes] = await Promise.allSettled([searchAudius(q, ctrl.signal), searchItunes(q, ctrl.signal)]);
  if (ctrl !== searchCtrl) return; // a newer search started

  const offline = !navigator.onLine;
  const errorText = (name) => (offline
    ? 'You’re offline. Connect to the internet to search online music.'
    : `Couldn’t reach ${name} right now. Try again in a moment.`);

  state.search.loading = false;
  state.search.results = {
    audius: audius.status === 'fulfilled' ? audius.value.map(adopt) : [],
    itunes: itunes.status === 'fulfilled' ? itunes.value.map(adopt) : [],
  };
  state.search.errors = {
    audius: audius.status === 'rejected' ? errorText('Audius') : null,
    itunes: itunes.status === 'rejected' ? errorText('Apple Music') : null,
  };
  if (audius.status === 'rejected') console.warn('Audius search failed', audius.reason);
  if (itunes.status === 'rejected') console.warn('iTunes search failed', itunes.reason);
  if (state.view === 'search') renderSearch();
}

els.search.addEventListener('input', () => {
  state.search.query = els.search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runOnlineSearch, 400);
  if (!state.search.query.trim()) runOnlineSearch();
  else renderSearch();
});

els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    runOnlineSearch();
    els.search.blur(); // hides the iPhone keyboard
  }
});

els.chips.forEach((chip) => chip.addEventListener('click', () => {
  state.search.filter = chip.dataset.filter;
  els.chips.forEach((c) => c.classList.toggle('active', c === chip));
  renderSearch();
}));

/* ---------- iPhone audio unlock ----------
   Safari only lets an <audio> element start playing from a tap. Songs load from
   IndexedDB asynchronously, which loses the tap, so on the very first tap we play
   a tiny silent clip on the element; after that Safari allows playback on it. */

let unlockUrl = null;

function silentWavUrl() {
  const samples = 800; // 0.1s at 8kHz, 8-bit mono
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, samples, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function unlockAudio() {
  ['click', 'touchend', 'keydown'].forEach((t) => document.removeEventListener(t, unlockAudio, true));
  if (els.audio.getAttribute('src')) return;
  unlockUrl = silentWavUrl();
  els.audio.src = unlockUrl;
  els.audio.play().then(() => {
    if (els.audio.src === unlockUrl) {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();
    }
  }).catch(() => {});
}

['click', 'touchend', 'keydown'].forEach((t) => document.addEventListener(t, unlockAudio, true));

/* ---------- Audio events ---------- */

els.audio.addEventListener('play', updatePlayState);
els.audio.addEventListener('pause', updatePlayState);
els.audio.addEventListener('ended', () => { if (state.currentId) playNext({ auto: true }); });
els.audio.addEventListener('error', () => {
  const song = songById(state.currentId);
  if (!song) return;
  toast(isLocal(song)
    ? 'Couldn’t play this song. The format may not be supported on this device.'
    : 'Couldn’t load this song. Check your internet connection or try another one.');
});

els.audio.addEventListener('loadedmetadata', () => {
  const d = els.audio.duration;
  els.seek.max = Number.isFinite(d) ? d : 0;
  els.timeTotal.textContent = formatTime(d);
  // Fill in a duration we couldn't read when the song was added.
  const song = songById(state.currentId);
  if (song && isLocal(song) && !song.duration && Number.isFinite(d)) {
    song.duration = d;
    updateSong(song);
    render();
  }
});

let lastPositionUpdate = 0;
els.audio.addEventListener('timeupdate', () => {
  if (!state.seeking) {
    els.seek.value = els.audio.currentTime;
    els.timeCurrent.textContent = formatTime(els.audio.currentTime);
    setRangeFill(els.seek);
  }
  const now = Date.now();
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && now - lastPositionUpdate > 1000) {
    lastPositionUpdate = now;
    const d = els.audio.duration;
    if (Number.isFinite(d) && d > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: d,
          playbackRate: els.audio.playbackRate,
          position: Math.min(els.audio.currentTime, d),
        });
      } catch { /* ignore */ }
    }
  }
});

els.audio.addEventListener('emptied', () => {
  els.seek.max = 0;
  els.seek.value = 0;
  setRangeFill(els.seek);
  els.timeCurrent.textContent = '0:00';
  els.timeTotal.textContent = '0:00';
});

els.audio.addEventListener('volumechange', () => {
  els.volume.value = els.audio.muted ? 0 : els.audio.volume;
  setRangeFill(els.volume);
  els.volume.parentElement.classList.toggle('muted', els.audio.muted || els.audio.volume === 0);
  saveSettings();
});

/* ---------- Controls ---------- */

els.play.addEventListener('click', togglePlay);
els.next.addEventListener('click', () => playNext());
els.prev.addEventListener('click', playPrev);
els.playLiked.addEventListener('click', () => playList(state.lists.liked || []));

els.shuffle.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  updateModeButtons();
  saveSettings();
});

els.repeat.addEventListener('click', () => {
  state.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(state.repeat) + 1) % REPEAT_MODES.length];
  updateModeButtons();
  saveSettings();
});

els.seek.addEventListener('input', () => {
  state.seeking = true;
  els.timeCurrent.textContent = formatTime(Number(els.seek.value));
  setRangeFill(els.seek);
});
els.seek.addEventListener('change', () => {
  if (state.currentId) els.audio.currentTime = Number(els.seek.value);
  state.seeking = false;
});

els.volume.addEventListener('input', () => {
  els.audio.muted = false;
  els.audio.volume = Number(els.volume.value);
});
els.mute.addEventListener('click', () => {
  els.audio.muted = !els.audio.muted;
});

els.npFav.addEventListener('click', () => state.currentId && toggleFavorite(state.currentId));

els.fileInput.addEventListener('change', async () => {
  const files = els.fileInput.files;
  if (files?.length) await addFiles(files);
  els.fileInput.value = '';
});

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      if (state.currentId) els.audio.currentTime = Math.min(els.audio.currentTime + 5, els.audio.duration || 0);
      break;
    case 'ArrowLeft':
      if (state.currentId) els.audio.currentTime = Math.max(els.audio.currentTime - 5, 0);
      break;
    case 'n':
    case 'N':
      playNext();
      break;
    case 'p':
    case 'P':
      playPrev();
      break;
    case '/':
      e.preventDefault();
      goTo('search');
      els.search.focus();
      break;
  }
});

/* ---------- Lock screen / headphone controls ---------- */

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => els.audio.play().catch(() => {}),
    pause: () => els.audio.pause(),
    previoustrack: playPrev,
    nexttrack: () => playNext(),
    seekto: (d) => { if (state.currentId) els.audio.currentTime = d.seekTime; },
    seekbackward: (d) => { els.audio.currentTime = Math.max(els.audio.currentTime - (d.seekOffset || 10), 0); },
    seekforward: (d) => { els.audio.currentTime = Math.min(els.audio.currentTime + (d.seekOffset || 10), els.audio.duration || 0); },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  }
}

/* ---------- Drag & drop (desktop) ---------- */

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.hidden = true;
  addFiles(e.dataTransfer.files);
});

/* ---------- Start ---------- */

async function init() {
  loadSettings();
  updateModeButtons();
  els.volume.value = els.audio.volume;
  setRangeFill(els.volume);
  setRangeFill(els.seek);

  try {
    state.songs = await getAllSongs();
    state.songs.forEach((s) => state.catalog.set(s.id, s));
  } catch (err) {
    console.error(err);
    toast('Couldn’t open your library. Private browsing may block storage.');
  }
  render();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
}

init();
