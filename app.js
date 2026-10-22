import { getAllSongs, addSong, updateSong, deleteSong, getSongBlob } from './db.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  fileInput: $('#file-input'),
  search: $('#search'),
  tabs: document.querySelectorAll('.tab'),
  list: $('#song-list'),
  summary: $('#summary'),
  empty: $('#empty'),
  emptyTitle: $('#empty-title'),
  emptyText: $('#empty-text'),
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
  npTitle: $('#np-title'),
  npArtist: $('#np-artist'),
  npFav: $('#np-fav'),
  dropOverlay: $('#drop-overlay'),
  toast: $('#toast'),
  editDialog: $('#edit-dialog'),
  editForm: $('#edit-form'),
};

const REPEAT_MODES = ['off', 'all', 'one'];

const state = {
  songs: [],
  view: 'all',
  query: '',
  queue: [],
  history: [],
  currentId: null,
  objectUrl: null,
  shuffle: false,
  repeat: 'off',
  seeking: false,
};

/* ---------- Settings (per device, best effort) ---------- */

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('my-music-settings') || '{}');
    state.shuffle = !!saved.shuffle;
    state.repeat = REPEAT_MODES.includes(saved.repeat) ? saved.repeat : 'off';
    if (typeof saved.volume === 'number') els.audio.volume = saved.volume;
  } catch { /* storage unavailable: use defaults */ }
}

function saveSettings() {
  try {
    localStorage.setItem('my-music-settings', JSON.stringify({
      shuffle: state.shuffle,
      repeat: state.repeat,
      volume: els.audio.volume,
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
  return state.songs.find((s) => s.id === id);
}

/* ---------- Library ---------- */

function visibleSongs() {
  const q = state.query.trim().toLowerCase();
  return state.songs
    .filter((s) => state.view !== 'favorites' || s.favorite)
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
    .sort((a, b) => b.addedAt - a.addedAt);
}

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09A6 6 0 0 1 16.5 3C19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z"/></svg>';
const DOTS = '<svg viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';

function render() {
  const songs = visibleSongs();
  const playing = !els.audio.paused;

  els.list.innerHTML = songs.map((s, i) => {
    const isCurrent = s.id === state.currentId;
    const index = isCurrent ? '<span class="eq"><i></i><i></i><i></i></span>' : i + 1;
    return `
      <li class="song${isCurrent ? ' playing' : ''}${isCurrent && !playing ? ' paused' : ''}" data-id="${s.id}">
        <span class="song-index">${index}</span>
        <div class="song-main">
          <div class="song-title">${escapeHtml(s.title)}</div>
          <div class="song-artist">${escapeHtml(s.artist || 'Unknown artist')}</div>
        </div>
        <button class="icon-btn fav-btn${s.favorite ? ' on' : ''}" data-action="fav"
          aria-label="${s.favorite ? 'Remove from' : 'Add to'} favorites">${HEART}</button>
        <span class="song-duration">${formatTime(s.duration)}</span>
        <div class="song-menu">
          <button class="icon-btn" data-action="menu" aria-label="More options">${DOTS}</button>
        </div>
      </li>`;
  }).join('');

  const total = state.songs.length;
  const hasFilter = state.query.trim() || state.view === 'favorites';
  els.empty.hidden = songs.length > 0;
  els.summary.hidden = songs.length === 0;
  els.summary.textContent = `${songs.length} song${songs.length === 1 ? '' : 's'}` +
    (songs.length ? ` · ${formatTime(songs.reduce((t, s) => t + (s.duration || 0), 0))}` : '');

  if (!songs.length) {
    if (!total) {
      els.emptyTitle.textContent = 'Your library is empty';
      els.emptyText.innerHTML = 'Tap <strong>Add songs</strong> to pick music files from this device.' +
        ' <span class="desktop-only">You can also drag &amp; drop files here.</span>';
    } else if (state.query.trim()) {
      els.emptyTitle.textContent = 'No matches';
      els.emptyText.textContent = `Nothing found for “${state.query.trim()}”.`;
    } else if (hasFilter) {
      els.emptyTitle.textContent = 'No favorites yet';
      els.emptyText.textContent = 'Tap the heart next to a song to add it here.';
    }
  }
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus|oga|webm)$/i.test(f.name));
  if (!files.length) {
    toast('No audio files found.');
    return;
  }

  let added = 0;
  const failed = [];
  toast(`Adding ${files.length} song${files.length === 1 ? '' : 's'}…`);

  for (const file of files) {
    try {
      // Copy the bytes so the song doesn't depend on the original file staying available.
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
      const duration = await readDuration(blob);
      const { artist, title } = parseFileName(file.name);
      const song = {
        id: newId(),
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
  await updateSong(song);
  render();
  updateNowPlaying();
}

async function removeSong(id) {
  const song = songById(id);
  if (!song || !confirm(`Delete “${song.title}” from your library?`)) return;
  if (id === state.currentId) stop();
  await deleteSong(id);
  state.songs = state.songs.filter((s) => s.id !== id);
  state.queue = state.queue.filter((q) => q !== id);
  state.history = state.history.filter((h) => h !== id);
  render();
  toast('Song deleted.');
}

function editSong(id) {
  const song = songById(id);
  if (!song) return;
  const form = els.editForm;
  form.elements.title.value = song.title;
  form.elements.artist.value = song.artist;
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
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `
    <button data-action="edit">Edit details</button>
    <button data-action="delete" class="danger">Delete</button>`;
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    e.stopPropagation();
    closeMenus();
    if (action === 'edit') editSong(id);
    if (action === 'delete') removeSong(id);
  });
  button.parentElement.append(menu);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.song-menu')) closeMenus();
});

els.list.addEventListener('click', (e) => {
  const row = e.target.closest('.song');
  if (!row) return;
  const id = row.dataset.id;
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'fav') return toggleFavorite(id);
  if (action === 'menu') return openMenu(e.target.closest('button'), id);
  if (e.target.closest('.menu')) return;

  if (id === state.currentId) {
    togglePlay();
  } else {
    playSong(id, visibleSongs().map((s) => s.id));
  }
});

/* ---------- Playback ---------- */

async function playSong(id, queue = state.queue, { fromHistory = false } = {}) {
  const song = songById(id);
  if (!song) return;

  const blob = await getSongBlob(id);
  if (!blob) {
    toast('This song’s file is missing. Try deleting and re-adding it.');
    return;
  }

  if (!fromHistory && state.currentId && state.currentId !== id) state.history.push(state.currentId);
  if (state.history.length > 200) state.history.shift();

  state.queue = queue;
  state.currentId = id;
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  els.audio.src = state.objectUrl;

  try {
    await els.audio.play();
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error(err);
      toast('Couldn’t play this song. The format may not be supported on this device.');
    }
  }
  updateNowPlaying();
  render();
}

function togglePlay() {
  if (!state.currentId) {
    const songs = visibleSongs();
    if (!songs.length) return;
    const ids = songs.map((s) => s.id);
    const first = state.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
    return playSong(first, ids);
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
  els.npArtist.textContent = song ? (song.artist || 'Unknown artist') : 'Pick a song to start';
  els.npFav.hidden = !song;
  els.npFav.classList.toggle('on', !!song?.favorite);
  els.npFav.setAttribute('aria-label', song?.favorite ? 'Remove from favorites' : 'Add to favorites');
  document.title = song && !els.audio.paused ? `${song.title} · My Music` : 'My Music';

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = song
      ? new MediaMetadata({
          title: song.title,
          artist: song.artist || 'Unknown artist',
          album: 'My Music',
          artwork: [
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
  render();
}

function updateModeButtons() {
  els.shuffle.setAttribute('aria-pressed', String(state.shuffle));
  els.repeat.dataset.mode = state.repeat;
  els.repeat.setAttribute('aria-label', `Repeat: ${state.repeat}`);
}

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
  if (state.currentId) toast('Couldn’t play this song. The format may not be supported on this device.');
});

els.audio.addEventListener('loadedmetadata', () => {
  const d = els.audio.duration;
  els.seek.max = Number.isFinite(d) ? d : 0;
  els.timeTotal.textContent = formatTime(d);
  // Fill in a duration we couldn't read when the song was added.
  const song = songById(state.currentId);
  if (song && !song.duration && Number.isFinite(d)) {
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

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  render();
});

els.tabs.forEach((tab) => tab.addEventListener('click', () => {
  state.view = tab.dataset.view;
  els.tabs.forEach((t) => {
    t.classList.toggle('active', t === tab);
    t.setAttribute('aria-selected', String(t === tab));
  });
  render();
}));

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
