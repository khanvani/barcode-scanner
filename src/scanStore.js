import { scanTimeValue } from './timeUtils';

const LS_PRIMARY = 'barcode-scans';
const LS_BACKUP = 'barcode-scans-backup';
const LS_PENDING = 'barcode-scans-pending';
const DB_NAME = 'ss-barcode-scanner';
const DB_STORE = 'kv';
const DB_RECORD = 'scans';

export function mergeScanLists(...lists) {
  const byBarcode = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const barcode = item?.barcode;
      if (!barcode) continue;
      const existing = byBarcode.get(barcode);
      if (!existing) {
        byBarcode.set(barcode, item);
        continue;
      }
      const tNew = Date.parse(scanTimeValue(item)) || 0;
      const tOld = Date.parse(scanTimeValue(existing)) || 0;
      if (tOld === 0 && tNew) byBarcode.set(barcode, item);
    }
  }
  return [...byBarcode.values()].sort((a, b) => {
    const tb = Date.parse(scanTimeValue(b)) || 0;
    const ta = Date.parse(scanTimeValue(a)) || 0;
    return tb - ta;
  });
}

function parseList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.barcode) : [];
  } catch {
    return [];
  }
}

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readLocalScans() {
  return mergeScanLists(parseList(lsGet(LS_PRIMARY)), parseList(lsGet(LS_BACKUP)));
}

export function persistScans(next, { allowEmpty = false } = {}) {
  if (!Array.isArray(next)) return false;
  if (next.length === 0 && !allowEmpty) return false;

  const json = JSON.stringify(next);
  const primary = lsSet(LS_PRIMARY, json);
  const backup = lsSet(LS_BACKUP, json);
  writeIdb(next).catch(() => {});
  return primary || backup;
}

export function readPending() {
  const value = lsGet(LS_PENDING);
  return value && value.trim() ? value : null;
}

export function persistPending(barcode) {
  if (!barcode) {
    lsRemove(LS_PENDING);
    return;
  }
  lsSet(LS_PENDING, barcode);
}

export function clearPending() {
  lsRemove(LS_PENDING);
}

export function clearStoredScans() {
  lsRemove(LS_PRIMARY);
  lsRemove(LS_BACKUP);
  lsRemove(LS_PENDING);
  lsSet(LS_PRIMARY, '[]');
  lsSet(LS_BACKUP, '[]');
  writeIdb([]).catch(() => {});
}

export async function hydrateScans(memory = []) {
  const idb = await readIdb();
  const merged = mergeScanLists(memory, readLocalScans(), idb);
  if (merged.length) persistScans(merged);
  return merged;
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readIdb() {
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_RECORD);
      req.onsuccess = () => {
        const value = req.result;
        resolve(Array.isArray(value) ? value : []);
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function writeIdb(items) {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(items, DB_RECORD);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
