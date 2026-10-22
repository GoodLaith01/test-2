// Reads song details from inside a file: title, artist, album, cover art,
// duration and whether it has a video track. Supports MP3 (ID3 tags) and
// MP4/M4A/MOV (iTunes-style tags), which covers music files and iPhone videos.
// Everything here is best effort: on any problem it returns what it found so far.

const MAX_TAG_BYTES = 16 * 1024 * 1024;

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

export async function readTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return await readMp3(file);
    if (latin1.decode(head.subarray(4, 8)) === 'ftyp') return await readMp4(file);
    if (isMpegFrame(head, 0)) return await readMp3(file);
  } catch (err) {
    console.warn('Could not read tags', file.name, err);
  }
  return {};
}

/* ---------- MP3 / ID3v2 ---------- */

const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const uint32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

function decodeText(bytes, encoding) {
  let text;
  if (encoding === 1 || encoding === 2) {
    let le = encoding === 1;
    let start = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { le = true; start = 2; }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { le = false; start = 2; }
    text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(start, start + ((bytes.length - start) & ~1)));
  } else {
    text = (encoding === 3 ? utf8 : latin1).decode(bytes);
  }
  return text.replace(/\0+$/, '').split('\0')[0].trim();
}

// Index just past the null terminator for the given text encoding.
function skipString(b, o, encoding) {
  if (encoding === 1 || encoding === 2) {
    while (o + 1 < b.length && (b[o] || b[o + 1])) o += 2;
    return o + 2;
  }
  while (o < b.length && b[o]) o++;
  return o + 1;
}

async function readMp3(file) {
  const result = {};
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let tagEnd = 0;

  if (latin1.decode(header.subarray(0, 3)) === 'ID3') {
    const version = header[3];
    const flags = header[5];
    const size = syncsafe(header, 6);
    tagEnd = 10 + size + (flags & 0x10 ? 10 : 0);
    const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, MAX_TAG_BYTES)).arrayBuffer());
    let o = 0;
    if (flags & 0x40 && version >= 3) o += version === 4 ? syncsafe(b, 0) : uint32(b, 0) + 4;

    const idLen = version === 2 ? 3 : 4;
    const hdrLen = version === 2 ? 6 : 10;
    while (o + hdrLen <= b.length) {
      const id = latin1.decode(b.subarray(o, o + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const frameSize = version === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]
        : version === 4 ? syncsafe(b, o + 4) : uint32(b, o + 4);
      const data = b.subarray(o + hdrLen, o + hdrLen + frameSize);
      o += hdrLen + frameSize;
      if (!frameSize || !data.length) continue;

      if (id === 'TIT2' || id === 'TT2') result.title ||= decodeText(data.subarray(1), data[0]);
      else if (id === 'TPE1' || id === 'TP1') result.artist ||= decodeText(data.subarray(1), data[0]);
      else if (id === 'TALB' || id === 'TAL') result.album ||= decodeText(data.subarray(1), data[0]);
      else if ((id === 'APIC' || id === 'PIC') && !result.artwork) {
        const enc = data[0];
        let p = 1;
        let mime;
        if (id === 'PIC') {
          mime = latin1.decode(data.subarray(1, 4)).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
          p = 4;
        } else {
          const end = skipString(data, 1, 0);
          mime = latin1.decode(data.subarray(1, end - 1)) || 'image/jpeg';
          if (!mime.includes('/')) mime = `image/${mime.toLowerCase() === 'png' ? 'png' : 'jpeg'}`;
          p = end;
        }
        p = skipString(data, p + 1, enc); // picture type byte, then description
        if (p < data.length) result.artwork = new Blob([data.slice(p)], { type: mime });
      }
    }
  }

  result.duration = await mp3Duration(file, tagEnd);
  return result;
}

const MPEG_BITRATES = {
  // [version-layer]: kbps by index
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

function isMpegFrame(b, o) {
  return b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0 && ((b[o + 1] >> 1) & 3) === 1;
}

async function mp3Duration(file, start) {
  const b = new Uint8Array(await file.slice(start, start + 64 * 1024).arrayBuffer());
  let o = 0;
  while (o + 4 < b.length && !isMpegFrame(b, o)) o++;
  if (o + 4 >= b.length) return 0;

  const verBits = (b[o + 1] >> 3) & 3;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 2.5;
  const bitrate = MPEG_BITRATES[`${version === 1 ? 1 : 2}-3`][b[o + 2] >> 4] * 1000;
  const sampleRate = MPEG_RATES[version][(b[o + 2] >> 2) & 3];
  if (!bitrate || !sampleRate) return 0;
  const mono = (b[o + 3] >> 6) === 3;
  const samplesPerFrame = version === 1 ? 1152 : 576;

  // VBR files carry the frame count in a Xing/Info or VBRI header.
  const sideInfo = version === 1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const x = o + 4 + sideInfo;
  const tag = latin1.decode(b.subarray(x, x + 4));
  if ((tag === 'Xing' || tag === 'Info') && (b[x + 7] & 1)) return (uint32(b, x + 8) * samplesPerFrame) / sampleRate;
  const v = o + 36;
  if (latin1.decode(b.subarray(v, v + 4)) === 'VBRI') return (uint32(b, v + 14) * samplesPerFrame) / sampleRate;

  return ((file.size - start - o) * 8) / bitrate;
}

/* ---------- MP4 / M4A / MOV ---------- */

function* atoms(b, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = uint32(b, o);
    const type = latin1.decode(b.subarray(o + 4, o + 8));
    let header = 8;
    if (size === 1) { size = uint32(b, o + 8) * 2 ** 32 + uint32(b, o + 12); header = 16; }
    else if (size === 0) size = end - o;
    if (size < header) return;
    yield { type, start: o + header, end: Math.min(o + size, end) };
    o += size;
  }
}

const child = (b, parent, type) => {
  for (const a of atoms(b, parent.start, parent.end)) if (a.type === type) return a;
  return null;
};

async function readMp4(file) {
  // Find the "moov" box (it can be at the start or the end of the file).
  let o = 0;
  let moov = null;
  while (o + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(o, o + 16).arrayBuffer());
    let size = uint32(h, 0);
    const type = latin1.decode(h.subarray(4, 8));
    let header = 8;
    if (size === 1) { size = uint32(h, 8) * 2 ** 32 + uint32(h, 12); header = 16; }
    else if (size === 0) size = file.size - o;
    if (size < header) break;
    if (type === 'moov') {
      if (size > MAX_TAG_BYTES) return {};
      moov = new Uint8Array(await file.slice(o, o + size).arrayBuffer());
      break;
    }
    o += size;
  }
  if (!moov) return {};

  const result = {};
  const root = { start: 8, end: moov.length };

  const mvhd = child(moov, root, 'mvhd');
  if (mvhd) {
    const v = moov[mvhd.start];
    const timescale = uint32(moov, mvhd.start + (v === 1 ? 20 : 12));
    const duration = v === 1
      ? uint32(moov, mvhd.start + 24) * 2 ** 32 + uint32(moov, mvhd.start + 28)
      : uint32(moov, mvhd.start + 16);
    if (timescale) result.duration = duration / timescale;
  }

  for (const a of atoms(moov, root.start, root.end)) {
    if (a.type !== 'trak') continue;
    const mdia = child(moov, a, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    if (hdlr && latin1.decode(moov.subarray(hdlr.start + 8, hdlr.start + 12)) === 'vide') result.hasVideo = true;
  }

  const udta = child(moov, root, 'udta');
  const meta = udta && child(moov, udta, 'meta');
  const ilst = meta && child(moov, { start: meta.start + 4, end: meta.end }, 'ilst');
  if (ilst) {
    for (const item of atoms(moov, ilst.start, ilst.end)) {
      const data = child(moov, item, 'data');
      if (!data) continue;
      const kind = uint32(moov, data.start) & 0xffffff;
      const value = moov.subarray(data.start + 8, data.end);
      if (item.type === '©nam') result.title = utf8.decode(value).trim();
      else if (item.type === '©ART') result.artist = utf8.decode(value).trim();
      else if (item.type === 'aART' && !result.artist) result.artist = utf8.decode(value).trim();
      else if (item.type === '©alb') result.album = utf8.decode(value).trim();
      else if (item.type === 'covr' && !result.artwork) {
        result.artwork = new Blob([value.slice()], { type: kind === 14 ? 'image/png' : 'image/jpeg' });
      }
    }
  }
  return result;
}

/* ---------- Video cover image ---------- */

// Grabs a frame from a video to use as its cover. Resolves to a JPEG Blob or null.
export function videoThumbnail(blob, size = 360) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 8000);

    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      const target = Number.isFinite(video.duration) ? Math.min(1.5, video.duration / 3) : 0;
      if (target > 0.05) video.currentTime = target;
      else draw();
    };
    video.onseeked = draw;

    function draw() {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return finish(null);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const side = Math.min(w, h);
        canvas.getContext('2d').drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
        canvas.toBlob((b) => finish(b), 'image/jpeg', 0.8);
      } catch {
        finish(null);
      }
    }

    video.src = url;
    // iOS only decodes frames once playback starts; muted inline play is allowed.
    video.play?.().then(() => video.pause()).catch(() => {});
  });
}
