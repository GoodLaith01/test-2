import { getAllSongs, addSong, updateSong, deleteSong, getSongBlob } from './db.js';
import { searchAudius, searchFamous, resolveStream } from './online.js';
import { readTags, videoThumbnail } from './tags.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
/** The element an event happened on. */
const targetOf = (e) => /** @type {HTMLElement} */ (e.target);
/**
 * The nearest element matching `sel`, starting where an event happened.
 * @returns {HTMLElement | null}
 */
const closest = (e, sel) => targetOf(e).closest(sel);

const els = {
  fileInput: $('#file-input'),
  views: $$('.view'),
  navBtns: $$('.nav-btn'),
  libraryList: $('[data-list="library"]'),
  librarySummary: $('#library-summary'),
  libraryEmpty: $('#library-empty'),
  likedList: $('[data-list="liked"]'),
  likedSummary: $('#liked-summary'),
  likedEmpty: $('#liked-empty'),
  playLiked: $('#play-liked'),
  search: $('#search'),
  searchClear: $('#search-clear'),
  chipsBox: $('.chips'),
  chips: $$('.chip'),
  searchResults: $('#search-results'),
  player: $('#player'),
  audio: $('#audio'),
  volume: $('#volume'),
  mute: $('#mute'),
  npOpen: $('#np-open'),
  npArt: $('#np-art'),
  npTitle: $('#np-title'),
  npArtist: $('#np-artist'),
  miniProgress: $('#mini-progress'),
  sheet: $('#np-sheet'),
  sheetClose: $('#np-close'),
  sheetArt: $('#sheet-art'),
  sheetVideo: $('#sheet-video'),
  sheetTitle: $('#sheet-title'),
  sheetArtist: $('#sheet-artist'),
  sheetNote: $('#np-note'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
  editDialog: $('#edit-dialog'),
  editForm: $('#edit-form'),
  editHint: $('#edit-hint'),
};

const REPEAT_MODES = ['off', 'all', 'one'];

const SOURCES = {
  local: { open: '' },
  deezer: { open: 'Open in Deezer' },
  itunes: { open: 'Open in Apple Music' },
  audius: { open: 'Open on Audius' },
};

const BROWSE = [
  { label: 'Top Hits', query: 'top hits', color: '#e13300' },
  { label: 'Arabic', query: 'arabic hits', color: '#8d67ab' },
  { label: 'Pop', query: 'pop', color: '#148a08' },
  { label: 'Lofi', query: 'lofi', color: '#503750' },
  { label: 'Focus', query: 'focus piano', color: '#1e3264' },
  { label: 'Chill', query: 'chill', color: '#477d95' },
  { label: 'Hip-Hop', query: 'hip hop', color: '#ba5d07' },
  { label: 'Workout', query: 'workout', color: '#777777' },
  { label: 'Love Songs', query: 'love songs', color: '#dc148c' },
  { label: 'Rock', query: 'rock', color: '#e91429' },
  { label: 'Jazz', query: 'jazz', color: '#0d73ec' },
  { label: 'Classical', query: 'classical', color: '#7d4b32' },
];

const state = {
  songs: [],            // saved in IndexedDB: songs added from this device + liked online songs
  catalog: new Map(),   // every song we know about (saved + search results), by id
  lists: {},            // ids shown in each list; tapping a song plays that list in order
  view: 'library',
  search: {
    query: '',
    filter: 'all',
    loading: false,
    results: { famous: [], audius: [] },
    errors: {},
    expanded: new Set(),
  },
  queue: [],
  history: [],
  currentId: null,
  objectUrl: null,
  shuffle: false,
  repeat: 'off',
  seeking: false,
  sheetOpen: false,
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

// Names the camera or photo picker gives files, which mean nothing to people.
const GENERIC_NAME = /^(img|vid|mov|trim|rpreplay|screenrecording|video|audio|recording|pxl|dsc)[\s._-]?|^[0-9a-f]{8}-[0-9a-f]{4}-|^\d+$/i;

function readDuration(blob) {
  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const finish = (value) => {
      clearTimeout(timer);
      probe.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(0), 5000);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) ? probe.duration : 0);
    probe.onerror = () => finish(0);
    probe.src = url;
  });
}

let toastTimer;
function toast(message, ms = 3500) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
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

// Cover image URL for a song (online songs have a link; local ones a stored image).
const artUrls = new Map();
function artUrl(song, large = false) {
  if (!song) return '';
  if (song.artworkBlob) {
    if (!artUrls.has(song.id)) artUrls.set(song.id, URL.createObjectURL(song.artworkBlob));
    return artUrls.get(song.id);
  }
  return (large && song.artworkLarge) || song.artwork || '';
}

function forgetArt(id) {
  const url = artUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  artUrls.delete(id);
}

/* ---------- Rendering ---------- */

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
const NOTE = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
const EQ = '<span class="eq"><i></i><i></i><i></i></span>';

// Length shown to people: the full song length, even for 30-second previews.
function shownDuration(s) {
  return s.source === 'deezer' || s.source === 'itunes' ? s.fullDuration || s.duration : s.duration;
}

function badgeFor(s) {
  if (s.source === 'deezer' || s.source === 'itunes') return '<span class="badge">Preview</span>';
  if (s.source === 'audius') return '<span class="badge badge-free">Full</span>';
  if (s.hasVideo) return '<span class="badge badge-video">Video</span>';
  return '';
}

function artistText(s) {
  return s.artist || (s.hasVideo ? 'From your videos' : 'Unknown artist');
}

function rowHtml(s, i) {
  const isCurrent = s.id === state.currentId;
  const paused = isCurrent && els.audio.paused;
  const art = artUrl(s);
  const thumb = art
    ? `<span class="thumb"><img src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async"></span>`
    : `<span class="thumb">${NOTE}</span>`;
  return `
    <li class="song${isCurrent ? ' playing' : ''}${paused ? ' paused' : ''}" data-id="${escapeHtml(s.id)}">
      <span class="song-index">${isCurrent ? EQ : i + 1}</span>
      ${thumb}
      <div class="song-main">
        <div class="song-title">${escapeHtml(s.title)}</div>
        <div class="song-artist">${badgeFor(s)}${escapeHtml(artistText(s))}</div>
      </div>
      <button type="button" class="icon-btn fav-btn${s.favorite ? ' on' : ''}" data-action="fav"
        aria-label="${s.favorite ? 'Remove from' : 'Add to'} Liked Songs">${HEART}</button>
      <span class="song-duration">${formatTime(shownDuration(s))}</span>
      <div class="song-menu">
        <button type="button" class="icon-btn" data-action="menu" aria-label="More options">${DOTS}</button>
      </div>
    </li>`;
}

function fillList(listEl, songs) {
  state.lists[listEl.dataset.list] = songs.map((s) => s.id);
  listEl.innerHTML = songs.map(rowHtml).join('');
}

function summaryText(songs) {
  const total = songs.reduce((t, s) => t + (shownDuration(s) || 0), 0);
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
  { key: 'famous', title: 'Songs', note: 'Famous songs · 30-second previews' },
  { key: 'audius', title: 'Full songs — free, no ads', note: 'Shared for free by artists on Audius' },
];
const SECTION_LIMIT = 6;

const SKELETON = `<ol class="song-list skeleton">${'<li class="song"><span></span><span class="thumb"></span><div class="song-main"><div class="sk-line"></div><div class="sk-line short"></div></div></li>'.repeat(4)}</ol>`;

function renderBrowse() {
  els.searchResults.innerHTML = `
    <h3 class="browse-title">Browse</h3>
    <div class="browse-grid">
      ${BROWSE.map((b) => `<button type="button" class="browse-tile" style="--tile:${b.color}" data-query="${escapeHtml(b.query)}">${escapeHtml(b.label)}</button>`).join('')}
    </div>
    <div class="search-hint">
      <p><span class="badge">Preview</span> Famous songs from any artist play as 30-second previews.</p>
      <p><span class="badge badge-free">Full</span> Full songs are free with no ads, shared by artists on Audius.</p>
      <p>Tap ♡ on any song to save it to <strong>Liked Songs</strong>.</p>
    </div>`;
}

function renderSearch() {
  const { query, filter, loading, results, errors, expanded } = state.search;
  const q = query.trim();
  els.searchClear.hidden = !query;
  els.chipsBox.hidden = !q;

  if (!q) {
    renderBrowse();
    return;
  }

  const songsFor = { local: localMatches(q), famous: results.famous, audius: results.audius };
  const html = SECTIONS
    .filter(({ key }) => filter === 'all' || filter === key)
    .map(({ key, title, note }) => {
      const songs = songsFor[key];
      let body;
      let more = '';
      if (key !== 'local' && loading) body = SKELETON;
      else if (key !== 'local' && errors[key]) body = `<p class="section-status">${escapeHtml(errors[key])}</p>`;
      else if (!songs.length) {
        if (filter === 'all') return '';
        body = '<p class="section-status">No results.</p>';
      } else {
        body = `<ol class="song-list" data-list="search-${key}"></ol>`;
        if (filter === 'all' && songs.length > SECTION_LIMIT && !expanded.has(key)) {
          more = `<button type="button" class="see-all" data-expand="${key}">See all ${songs.length}</button>`;
        }
      }
      return `
        <section class="result-section">
          <div class="section-head">
            <h3>${title}</h3>
            ${note ? `<p class="section-note">${note}</p>` : ''}
          </div>
          ${body}
          ${more}
        </section>`;
    }).join('');

  els.searchResults.innerHTML = html || (loading ? '' : `
    <div class="empty small">
      <h3>No results for “${escapeHtml(q)}”</h3>
      <p>Check the spelling, or try an artist or song name.</p>
    </div>`);

  for (const { key } of SECTIONS) {
    const list = els.searchResults.querySelector(`[data-list="search-${key}"]`);
    if (!list) continue;
    const all = songsFor[key];
    const show = filter === 'all' && !expanded.has(key) ? all.slice(0, SECTION_LIMIT) : all;
    fillList(list, show);
    state.lists[`search-${key}`] = all.map((s) => s.id); // play the whole section, not just what's shown
  }
}

function render() {
  els.views.forEach((v) => { v.hidden = v.dataset.view !== state.view; });
  els.navBtns.forEach((b) => {
    const active = b.dataset.goto === state.view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.dataset.view = state.view;
  if (state.view === 'library') renderLibrary();
  if (state.view === 'liked') renderLiked();
  if (state.view === 'search') renderSearch();
}

function goTo(view) {
  closeSheet();
  if (state.view === view) return;
  state.view = view;
  closeMenus();
  render();
  saveSettings();
  window.scrollTo(0, 0);
  if (view === 'search' && matchMedia('(hover: hover)').matches) els.search.focus();
}

// Broken cover images fall back to the music-note placeholder.
document.addEventListener('error', (e) => {
  const img = /** @type {HTMLImageElement} */ (e.target);
  if (img.tagName !== 'IMG') return;
  if (img.closest('.thumb')) img.closest('.thumb').innerHTML = NOTE;
  else if (img === els.npArt || img === els.sheetArt) img.hidden = true;
}, true);

/* ---------- Adding songs ---------- */

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus|oga|weba|webm|mp4|m4v|mov|3gp|caf|aif|aiff)$/i;

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || f.type.startsWith('video/') || AUDIO_EXT.test(f.name));
  if (!files.length) {
    toast('Those files aren’t songs or videos.');
    return;
  }

  let added = 0;
  const failed = [];
  const newSongs = [];
  if (state.view !== 'library') goTo('library');

  for (const [i, file] of files.entries()) {
    toast(files.length > 1 ? `Adding ${i + 1} of ${files.length}…` : 'Adding…', 60000);
    try {
      // Copy the bytes so the song doesn't depend on the original file staying available.
      const type = file.type || (/\.(mov|mp4|m4v)$/i.test(file.name) ? 'video/mp4' : 'audio/mpeg');
      const blob = new Blob([await file.arrayBuffer()], { type });
      const tags = await readTags(blob);
      const hasVideo = !!tags.hasVideo || (type.startsWith('video/') && tags.hasVideo !== false && !tags.duration);
      const duration = tags.duration || await readDuration(blob);
      const fromName = parseFileName(file.name);
      const artworkBlob = tags.artwork || (hasVideo || type.startsWith('video/') ? await videoThumbnail(blob) : null);

      const song = {
        id: newId(),
        source: 'local',
        title: tags.title || fromName.title,
        artist: tags.artist || fromName.artist,
        album: tags.album || '',
        duration,
        type: blob.type,
        size: blob.size,
        fileName: file.name,
        hasVideo: !!(hasVideo || (type.startsWith('video/') && artworkBlob)),
        artworkBlob: artworkBlob || undefined,
        favorite: false,
        addedAt: Date.now() + added, // keeps the picked order stable
      };
      await addSong(song, blob);
      state.songs.push(song);
      state.catalog.set(song.id, song);
      newSongs.push(song);
      added++;
      render();
    } catch (err) {
      console.error('Could not add', file.name, err);
      failed.push(file.name);
    }
  }

  if (added) navigator.storage?.persist?.().catch(() => {});

  if (failed.length) {
    const quota = failed.length && added === 0 ? ' Your device may be out of space.' : '';
    toast(`Added ${added}. Couldn’t add ${failed.length}: ${failed.slice(0, 2).join(', ')}${failed.length > 2 ? '…' : ''}.${quota}`, 6000);
  } else {
    toast(`Added ${added} song${added === 1 ? '' : 's'}.`);
  }

  // A single video with a camera name like "IMG_1234" gets a real name right away.
  if (newSongs.length === 1 && GENERIC_NAME.test(newSongs[0].title)) editSong(newSongs[0].id, { isNew: true });
}

/* ---------- Liking, editing, deleting ---------- */

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
  forgetArt(id);
  state.queue = state.queue.filter((q) => q !== id);
  state.history = state.history.filter((h) => h !== id);
  render();
  toast('Song deleted.');
}

function editSong(id, { isNew = false } = {}) {
  const song = songById(id);
  if (!song) return;
  els.editForm.elements.title.value = isNew ? '' : song.title;
  els.editForm.elements.title.placeholder = song.title;
  els.editForm.elements.artist.value = song.artist;
  els.editHint.hidden = !isNew;
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
  $$('.menu').forEach((m) => m.remove());
}

function openMenu(button, id) {
  closeMenus();
  const song = songById(id);
  if (!song) return;
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = isLocal(song)
    ? `<button type="button" data-action="edit">Edit name</button>
       <button type="button" data-action="delete" class="danger">Delete from device</button>`
    : `<button type="button" data-action="like">${song.favorite ? 'Remove from' : 'Save to'} Liked Songs</button>
       ${song.link ? `<a href="${escapeHtml(song.link)}" target="_blank" rel="noopener">${SOURCES[song.source].open} ↗</a>` : ''}`;
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    if (closest(e, 'a')) {
      setTimeout(closeMenus); // let the link open first
      return;
    }
    const action = closest(e, 'button')?.dataset.action;
    closeMenus();
    if (action === 'edit') editSong(id);
    if (action === 'delete') removeSong(id);
    if (action === 'like') toggleFavorite(id);
  });
  button.parentElement.append(menu);
}

document.addEventListener('click', (e) => {
  if (!closest(e, '.song-menu')) closeMenus();
  const goto = closest(e, '[data-goto]');
  if (goto) goTo(goto.dataset.goto);
  const cmd = closest(e, '[data-cmd]');
  if (cmd) runCommand(cmd.dataset.cmd);
});

document.querySelector('main').addEventListener('click', (e) => {
  const tile = closest(e, '[data-query]');
  if (tile) {
    els.search.value = tile.dataset.query;
    onSearchInput({ immediate: true });
    return;
  }
  const expand = closest(e, '[data-expand]');
  if (expand) {
    state.search.expanded.add(expand.dataset.expand);
    renderSearch();
    return;
  }

  const row = closest(e, '.song');
  if (!row || closest(e, '.menu') || row.closest('.skeleton')) return;
  const id = row.dataset.id;
  const action = closest(e, '[data-action]')?.dataset.action;
  if (action === 'fav') return toggleFavorite(id);
  if (action === 'menu') return openMenu(closest(e, 'button'), id);

  if (id === state.currentId) {
    togglePlay();
  } else {
    const list = /** @type {HTMLElement} */ (row.closest('[data-list]'));
    playSong(id, state.lists[list.dataset.list] || [id]);
  }
});

/* ---------- Playback ---------- */

let playToken = 0;

async function playSong(id, queue = state.queue, { fromHistory = false } = {}) {
  const song = songById(id);
  if (!song) return;
  const token = ++playToken;

  if (!fromHistory && state.currentId && state.currentId !== id) state.history.push(state.currentId);
  if (state.history.length > 200) state.history.shift();
  state.queue = queue;
  state.currentId = id;
  updateNowPlaying();
  render();

  let src;
  try {
    if (isLocal(song)) {
      const blob = await getSongBlob(id);
      if (!blob) throw new Error('missing');
      if (token !== playToken) return;
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = URL.createObjectURL(blob);
      src = state.objectUrl;
    } else {
      if (!navigator.onLine) toast('You’re offline. Online songs need an internet connection.');
      src = await resolveStream(song);
      if (token !== playToken) return;
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  } catch (err) {
    console.error(err);
    if (token === playToken) {
      toast(isLocal(song) ? 'This song’s file is missing. Try deleting and adding it again.' : 'Couldn’t load this song. Check your connection.');
    }
    return;
  }

  els.audio.src = src;
  syncSheetMedia();
  try {
    await els.audio.play();
  } catch (err) {
    if (err.name !== 'AbortError' && token === playToken) {
      console.error(err);
      toast('Couldn’t play this song.');
    }
  }
  updateNowPlaying();
}

function playList(ids) {
  if (!ids.length) return;
  const first = state.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
  return playSong(first, ids);
}

function visibleListIds() {
  if (state.view !== 'search') return state.lists[state.view] || [];
  const list = els.searchResults.querySelector('[data-list]');
  return list ? state.lists[list.dataset.list] || [] : [];
}

function togglePlay() {
  if (!state.currentId) return playList(visibleListIds());
  if (els.audio.paused) {
    els.audio.play().catch(() => {});
  } else {
    els.audio.pause();
  }
}

function stop() {
  playToken++;
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  state.currentId = null;
  closeSheet();
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
      updatePlayState();
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

function runCommand(cmd) {
  if (cmd === 'play') togglePlay();
  else if (cmd === 'next') playNext();
  else if (cmd === 'prev') playPrev();
  else if (cmd === 'fav') { if (state.currentId) toggleFavorite(state.currentId); }
  else if (cmd === 'shuffle') {
    state.shuffle = !state.shuffle;
    updateModeButtons();
    saveSettings();
    toast(state.shuffle ? 'Shuffle on' : 'Shuffle off', 1500);
  } else if (cmd === 'repeat') {
    state.repeat = REPEAT_MODES[(REPEAT_MODES.indexOf(state.repeat) + 1) % REPEAT_MODES.length];
    updateModeButtons();
    saveSettings();
    toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat this song' }[state.repeat], 1500);
  }
}

function isPreview(song) {
  return song?.source === 'deezer' || song?.source === 'itunes';
}

function updateNowPlaying() {
  const song = songById(state.currentId);
  els.player.hidden = !song;
  document.body.classList.toggle('has-player', !!song);

  els.npTitle.textContent = song ? song.title : 'Nothing playing';
  els.npArtist.textContent = song ? `${artistText(song)}${isPreview(song) ? ' · Preview' : ''}` : '';
  const art = artUrl(song);
  if (art) {
    if (els.npArt.getAttribute('src') !== art) els.npArt.src = art;
    els.npArt.hidden = false;
  } else {
    els.npArt.hidden = true;
    els.npArt.removeAttribute('src');
  }

  $$('[data-cmd="fav"]').forEach((b) => {
    b.classList.toggle('on', !!song?.favorite);
    b.setAttribute('aria-label', song?.favorite ? 'Remove from Liked Songs' : 'Add to Liked Songs');
  });
  document.title = song && !els.audio.paused ? `${song.title} · My Music` : 'My Music';
  updateSheet();

  if ('mediaSession' in navigator) {
    const big = artUrl(song, true);
    navigator.mediaSession.metadata = song
      ? new MediaMetadata({
          title: song.title,
          artist: song.artist || 'Unknown artist',
          album: song.album || 'My Music',
          artwork: big
            ? [{ src: big, sizes: '512x512' }]
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
  document.body.classList.toggle('is-playing', playing);
  $$('[data-cmd="play"]').forEach((b) => b.setAttribute('aria-label', playing ? 'Pause' : 'Play'));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  updateNowPlaying();
  $$('.song').forEach((row) => {
    const isCurrent = row.dataset.id === state.currentId;
    row.classList.toggle('playing', isCurrent);
    row.classList.toggle('paused', isCurrent && !playing);
  });
  syncVideo();
}

function updateModeButtons() {
  $$('[data-cmd="shuffle"]').forEach((b) => b.setAttribute('aria-pressed', String(state.shuffle)));
  $$('[data-cmd="repeat"]').forEach((b) => {
    b.dataset.mode = state.repeat;
    b.setAttribute('aria-label', `Repeat: ${state.repeat}`);
  });
}

/* ---------- Now Playing screen (with video) ---------- */

function openSheet() {
  if (!state.currentId) return;
  state.sheetOpen = true;
  els.sheet.hidden = false;
  document.body.classList.add('sheet-open');
  updateSheet();
  syncSheetMedia();
}

function closeSheet() {
  if (!state.sheetOpen) return;
  state.sheetOpen = false;
  els.sheet.hidden = true;
  document.body.classList.remove('sheet-open');
  els.sheetVideo.pause();
  els.sheetVideo.removeAttribute('src');
  els.sheetVideo.load();
}

function updateSheet() {
  if (!state.sheetOpen) return;
  const song = songById(state.currentId);
  if (!song) return closeSheet();
  els.sheetTitle.textContent = song.title;
  els.sheetArtist.textContent = artistText(song);
  const showVideo = isLocal(song) && song.hasVideo;
  const art = artUrl(song, true);
  els.sheetArt.hidden = showVideo || !art;
  if (!showVideo && art && els.sheetArt.getAttribute('src') !== art) els.sheetArt.src = art;
  els.sheetVideo.hidden = !showVideo;
  els.sheetNote.hidden = !isPreview(song);
  els.sheetNote.textContent = isPreview(song)
    ? 'This is a 30-second preview. To hear the whole song, add a music file you own in My Songs, or open it in a music app from the ⋯ menu.'
    : '';
}

// The video is shown muted and follows the song, so the music keeps playing
// even when the screen is locked or you switch apps.
function syncSheetMedia() {
  if (!state.sheetOpen) return;
  const song = songById(state.currentId);
  if (!song || !isLocal(song) || !song.hasVideo || !state.objectUrl) {
    if (els.sheetVideo.getAttribute('src')) {
      els.sheetVideo.removeAttribute('src');
      els.sheetVideo.load();
    }
    return;
  }
  if (els.sheetVideo.getAttribute('src') !== state.objectUrl) {
    els.sheetVideo.src = state.objectUrl;
    els.sheetVideo.currentTime = els.audio.currentTime || 0;
  }
  syncVideo();
}

function syncVideo() {
  const v = els.sheetVideo;
  if (!state.sheetOpen || !v.getAttribute('src') || document.hidden) return;
  if (Math.abs(v.currentTime - els.audio.currentTime) > 0.3) {
    try { v.currentTime = els.audio.currentTime; } catch { /* not seekable yet */ }
  }
  if (els.audio.paused) v.pause();
  else v.play().catch(() => {});
}

els.npOpen.addEventListener('click', openSheet);
els.sheetClose.addEventListener('click', closeSheet);
els.sheet.addEventListener('click', (e) => { if (e.target === els.sheet) closeSheet(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) els.sheetVideo.pause();
  else syncVideo();
});

/* ---------- Search ---------- */

let searchTimer;
let searchCtrl;

function errorText(name) {
  return navigator.onLine
    ? `Couldn’t reach ${name} right now. Try again in a moment.`
    : 'You’re offline. Connect to the internet to search online music.';
}

async function runOnlineSearch() {
  const q = state.search.query.trim();
  searchCtrl?.abort();
  state.search.expanded = new Set();
  if (q.length < 2) {
    state.search.loading = false;
    state.search.results = { famous: [], audius: [] };
    state.search.errors = {};
    renderSearch();
    return;
  }

  const ctrl = new AbortController();
  searchCtrl = ctrl;
  state.search.loading = true;
  renderSearch();

  const [famous, audius] = await Promise.allSettled([searchFamous(q, ctrl.signal), searchAudius(q, ctrl.signal)]);
  if (ctrl !== searchCtrl) return; // a newer search started

  state.search.loading = false;
  state.search.results = {
    famous: famous.status === 'fulfilled' ? famous.value.map(adopt) : [],
    audius: audius.status === 'fulfilled' ? audius.value.map(adopt) : [],
  };
  state.search.errors = {
    famous: famous.status === 'rejected' ? errorText('the music catalog') : null,
    audius: audius.status === 'rejected' ? errorText('Audius') : null,
  };
  if (famous.status === 'rejected') console.warn('Famous songs search failed', famous.reason);
  if (audius.status === 'rejected') console.warn('Audius search failed', audius.reason);
  if (state.view === 'search') renderSearch();
}

function onSearchInput({ immediate = false } = {}) {
  state.search.query = els.search.value;
  clearTimeout(searchTimer);
  if (immediate || !state.search.query.trim()) runOnlineSearch();
  else {
    searchTimer = setTimeout(runOnlineSearch, 350);
    renderSearch();
  }
}

els.search.addEventListener('input', () => onSearchInput());
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    onSearchInput({ immediate: true });
    els.search.blur(); // hides the iPhone keyboard
  }
});
els.searchClear.addEventListener('click', () => {
  els.search.value = '';
  onSearchInput();
  els.search.focus();
});

els.chips.forEach((chip) => chip.addEventListener('click', () => {
  state.search.filter = chip.dataset.filter;
  els.chips.forEach((c) => c.classList.toggle('active', c === chip));
  renderSearch();
}));

/* ---------- iPhone audio unlock ----------
   Safari only lets an <audio> element start playing from a tap. Songs load
   asynchronously, which loses the tap, so on the very first tap we play a tiny
   silent clip on the element; after that Safari allows playback on it. */

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
els.audio.addEventListener('seeked', syncVideo);
els.audio.addEventListener('error', () => {
  const song = songById(state.currentId);
  if (!song || !els.audio.getAttribute('src') || els.audio.src === unlockUrl) return;
  toast(isLocal(song)
    ? 'Couldn’t play this song. The format may not be supported on this device.'
    : 'Couldn’t load this song. Check your internet connection or try another one.');
});

els.audio.addEventListener('loadedmetadata', () => {
  if (!state.currentId) return;
  const d = els.audio.duration;
  $$('.seek-input').forEach((s) => { s.max = Number.isFinite(d) ? d : 0; });
  $$('.time-total').forEach((t) => { t.textContent = formatTime(d); });
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
  if (!state.currentId) return;
  const t = els.audio.currentTime;
  const d = els.audio.duration;
  if (!state.seeking) {
    $$('.seek-input').forEach((s) => { s.value = t; setRangeFill(s); });
    $$('.time-current').forEach((el) => { el.textContent = formatTime(t); });
  }
  els.miniProgress.style.width = Number.isFinite(d) && d > 0 ? `${(t / d) * 100}%` : '0%';
  syncVideo();

  const now = Date.now();
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && now - lastPositionUpdate > 1000) {
    lastPositionUpdate = now;
    if (Number.isFinite(d) && d > 0) {
      try {
        navigator.mediaSession.setPositionState({ duration: d, playbackRate: els.audio.playbackRate, position: Math.min(t, d) });
      } catch { /* ignore */ }
    }
  }
});

els.audio.addEventListener('emptied', () => {
  $$('.seek-input').forEach((s) => { s.max = 0; s.value = 0; setRangeFill(s); });
  $$('.time-current, .time-total').forEach((el) => { el.textContent = '0:00'; });
  els.miniProgress.style.width = '0%';
});

els.audio.addEventListener('volumechange', () => {
  els.volume.value = els.audio.muted ? 0 : els.audio.volume;
  setRangeFill(els.volume);
  els.volume.parentElement.classList.toggle('muted', els.audio.muted || els.audio.volume === 0);
  saveSettings();
});

/* ---------- Controls ---------- */

els.playLiked.addEventListener('click', () => playList(state.lists.liked || []));

$$('.seek-input').forEach((seek) => {
  seek.addEventListener('input', () => {
    state.seeking = true;
    $$('.time-current').forEach((el) => { el.textContent = formatTime(Number(seek.value)); });
    $$('.seek-input').forEach((s) => { s.value = seek.value; setRangeFill(s); });
  });
  seek.addEventListener('change', () => {
    if (state.currentId) els.audio.currentTime = Number(seek.value);
    state.seeking = false;
  });
});

els.volume.addEventListener('input', () => {
  els.audio.muted = false;
  els.audio.volume = Number(els.volume.value);
});
els.mute.addEventListener('click', () => {
  els.audio.muted = !els.audio.muted;
});

els.fileInput.addEventListener('change', async () => {
  const files = els.fileInput.files;
  if (files?.length) await addFiles(files);
  els.fileInput.value = '';
});

/* ---------- Keyboard shortcuts ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sheetOpen) return closeSheet();
  if (closest(e, 'input, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case ' ':
      if (closest(e, 'button')) return;
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
    try {
      navigator.mediaSession.setActionHandler(/** @type {MediaSessionAction} */ (action), handler);
    } catch { /* unsupported action */ }
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
  $$('.seek-input').forEach(setRangeFill);

  try {
    state.songs = await getAllSongs();
    state.songs.forEach((s) => state.catalog.set(s.id, s));
  } catch (err) {
    console.error(err);
    toast('Couldn’t open your library. Private browsing may block storage.');
  }
  render();
  updateNowPlaying();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
}

init();
