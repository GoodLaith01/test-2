# My Music

A personal, Spotify-style music player that runs in your browser. Add your own
song files and listen to your favorites while you work — on **Windows** and
**iPhone**.

- **My Songs** — add songs from your device (or drag & drop them on a computer)
- **Liked Songs** — tap ♡ on any song to save it to your Liked Songs playlist
- **Search** — your own songs plus free music online:
  - full songs, free and with no ads, from [Audius](https://audius.co)
  - famous hits as 30-second previews from Apple Music
- Shuffle, repeat, seek and volume
- Lock-screen and headphone/keyboard media controls
- Works offline and installs like an app
- Free, no ads, no account — your songs stay on your device

See [PLAN.md](PLAN.md) for what's done and what's next.

## Use it

### Put it online (once)

1. Push this project to the `main` branch on GitHub.
2. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The *Deploy to GitHub Pages* workflow publishes it to
   `https://<your-username>.github.io/<repo-name>/`.

### Windows (Chrome or Edge)

1. Open the site.
2. Click the **Install** icon in the address bar to get a desktop app.
3. Click **Add songs** (or drag files onto the window) to add MP3/M4A/WAV/FLAC files.

Keyboard: **Space** play/pause · **← / →** skip 5 seconds · **N / P** next/previous · **/** search.

### iPhone (Safari)

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen**, then open *My Music* from the Home Screen.
3. Tap **Add songs → Browse** and pick music files from the **Files** app or
   iCloud Drive.

Notes:
- **Famous songs** play as 30-second previews. Full versions of famous songs
  from big labels can't legally be streamed for free without ads, so to hear
  the whole song, add a music file you own to *My Songs*.
- Searching and playing online songs needs an internet connection; songs in
  *My Songs* work offline.
- Songs must be real audio files. Songs from Apple Music or Spotify are
  protected and can't be added.
- Each device keeps its own library — add your songs on each device you use.
- Large libraries use storage on your phone; iOS may clear website storage for
  apps you haven't opened in a long time.

## Run it locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step or dependencies — just HTML, CSS and JavaScript.
