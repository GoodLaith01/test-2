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
- **Only free, legal music sources, no ads.** Online search uses public APIs
  that need no account or key.

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

## Phase 1.5 — Liked Songs & Search (done)

- [x] Three places: **My Songs**, **Liked Songs**, **Search** (bottom tab bar on iPhone)
- [x] Liked Songs playlist: like any song (your own or from Search), play all
- [x] Search your songs + free online music in one place
- [x] Full songs, free and ad-free, from Audius (artists share them for free)
- [x] Famous hits as 30-second previews from Apple Music (iTunes Search API)
- [x] Album artwork, "Free" / "Preview" labels, "Open in…" links

### About famous songs

Famous songs from big labels are licensed — no service can legally stream the
full versions for free without ads or a subscription. This app only uses free,
legal sources and never shows ads; famous songs play as 30-second previews,
and you can add full songs you own as files in **My Songs**.

## Phase 2 — Nicer library

- [ ] Your own playlists (create, rename, add/remove songs, reorder)
- [ ] More free sources (e.g. Internet Archive, Jamendo)
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
