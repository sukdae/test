// 기기 내 저장: 세션은 IndexedDB, 설정은 localStorage

const DB_NAME = 'formcheck';
const STORE = 'sessions';
let dbp = null;

function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('저장 공간이 부족할 수 있어요.'));
  });
}

export const saveSession = (s) => tx('readwrite', (st) => st.put(s));
export const getSession = (id) => tx('readonly', (st) => st.get(id));
export const deleteSession = (id) => tx('readwrite', (st) => st.delete(id));
export const clearSessions = () => tx('readwrite', (st) => st.clear());
export async function listSessions() {
  const all = (await tx('readonly', (st) => st.getAll())) || [];
  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const SETTINGS_KEY = 'formcheck.settings';
const DEFAULTS = { onboarded: false, saveVideo: false, exercise: 'squat', references: {} };

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function setSetting(key, value) {
  const s = getSettings();
  s[key] = value;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* 저장 불가 환경 */ }
  return s;
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? e.usage : null;
  } catch { return null; }
}
