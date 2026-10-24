// Trwały zapis bazy w telefonie (IndexedDB). Dane nie opuszczają urządzenia.

const DB_NAME = "budzet-mobile";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function get(key) { return withStore("readonly", (s) => s.get(key)); }
export function set(key, value) { return withStore("readwrite", (s) => s.put(value, key)); }
export function remove(key) { return withStore("readwrite", (s) => s.delete(key)); }

/** Prosi system, żeby nie usuwał danych przy braku miejsca. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* nieobsługiwane */ }
  return false;
}
