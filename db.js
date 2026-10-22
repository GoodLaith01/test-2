// Song storage in IndexedDB. Metadata and audio data live in separate stores
// so the library list loads quickly without reading every audio file.

const DB_NAME = 'my-music';
const DB_VERSION = 1;

let dbPromise;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSongs() {
  const db = await openDb();
  return result(db.transaction('songs').objectStore('songs').getAll());
}

export async function addSong(song, blob) {
  const db = await openDb();
  const tx = db.transaction(['songs', 'files'], 'readwrite');
  tx.objectStore('songs').put(song);
  tx.objectStore('files').put({ id: song.id, blob });
  await done(tx);
}

export async function updateSong(song) {
  const db = await openDb();
  const tx = db.transaction('songs', 'readwrite');
  tx.objectStore('songs').put(song);
  await done(tx);
}

export async function deleteSong(id) {
  const db = await openDb();
  const tx = db.transaction(['songs', 'files'], 'readwrite');
  tx.objectStore('songs').delete(id);
  tx.objectStore('files').delete(id);
  await done(tx);
}

export async function getSongBlob(id) {
  const db = await openDb();
  const record = await result(db.transaction('files').objectStore('files').get(id));
  return record?.blob;
}
