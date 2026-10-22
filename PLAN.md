# My Music — Plan

A personal, Spotify-style music player website. Add your own song files, then
listen to your favorites while you work — on Windows (Chrome/Edge) and iPhone
(Safari, installed to the Home Screen).

## Key decisions

- **No server, no account.** Songs are stored inside the browser on each device
  (IndexedDB). Nothing is uploaded anywhere.
- **Installable web app (PWA).** Works offline once loaded; on iPhone use
  Share → *Add to Home Screen*, on Windows use the *Install* icon in the
  address bar.
- **Plain HTML/CSS/JavaScript.** No build step — any static host works
  (GitHub Pages is set up via a workflow).
- **Each device has its own library.** Songs added on Windows are not on the
  iPhone automatically (see Phase 3 for sync).

## Phase 1 — MVP (this first version)

- [x] Add songs from the device (file picker; drag & drop on desktop)
- [x] Library list with search
- [x] Favorites (heart) + Favorites tab
- [x] Player bar: play/pause, previous/next, seek, volume, shuffle, repeat
- [x] Edit a song's title/artist, delete songs
- [x] Lock-screen / keyboard media controls (Media Session API)
- [x] Keyboard shortcuts on desktop (Space, ←/→, N/P)
- [x] Installable + offline (manifest, service worker, icons)
- [x] Mobile layout with iPhone safe areas, dark Spotify-like theme
- [x] GitHub Pages deploy workflow

## Phase 2 — Nicer library

- [ ] Playlists (create, rename, add/remove songs, reorder)
- [ ] Read title/artist/album art from the song's tags (ID3)
- [ ] Sort by title / artist / date added; "Recently played"
- [ ] Remember the last song and position between visits
- [ ] Storage usage indicator and "export/import library" backup

## Phase 3 — Same library on Windows and iPhone (optional)

- [ ] Choose a sync approach: cloud storage (e.g. OneDrive/Google Drive
      folder) or a small backend with login
- [ ] Sync songs, favorites and playlists between devices

## How to run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```
