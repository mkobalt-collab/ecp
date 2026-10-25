// Magazyn IndexedDB: baza `ecp` v1 (outbox, cache, kv).
const DB_NAME = 'ecp';
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { dbPromise = null; reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('outbox', { keyPath: 'clientId' });
        db.createObjectStore('cache', { keyPath: 'key' });
        db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = e => reject((e && e.target && e.target.error) || tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana.'));
  });
}

export const outboxAdd = item => run('outbox', 'readwrite', s => s.add(item));
export const outboxPut = item => run('outbox', 'readwrite', s => s.put(item));
export const outboxRemove = clientId => run('outbox', 'readwrite', s => s.delete(clientId));
export async function outboxList() {
  const all = await run('outbox', 'readonly', s => s.getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export const cacheGet = key => run('cache', 'readonly', s => s.get(key));
export const cacheSet = (key, data) => run('cache', 'readwrite', s => s.put({ key, data, savedAt: Date.now() }));

export async function kvGet(k) {
  const row = await run('kv', 'readonly', s => s.get(k));
  return row ? row.v : undefined;
}
export const kvSet = (k, v) => run('kv', 'readwrite', s => s.put({ k, v }));
export const kvDel = k => run('kv', 'readwrite', s => s.delete(k));

export async function clearAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['outbox', 'cache', 'kv'], 'readwrite');
    for (const n of ['outbox', 'cache', 'kv']) tx.objectStore(n).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject((e && e.target && e.target.error) || tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana.'));
  });
}
