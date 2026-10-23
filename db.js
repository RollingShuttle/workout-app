// db.js — IndexedDB 封装。所有数据只存本机（spec 2.5）；不用 localStorage。
// 库：workout-tracker v1。表：sessions（keyPath id，索引 date）、settings（keyPath key）。
// 草稿 = finishedAt 为 null 的 session，和已完成的训练放同一张表，结束训练时填 finishedAt 即可。

const DB_NAME = 'workout-tracker';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('此浏览器不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 另一个标签页升级数据库时关掉本连接，下次重新打开
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('打开数据库失败'));
    req.onblocked = () => reject(new Error('数据库被其他页面占用'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('数据库操作失败'));
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('事务失败'));
    tx.onabort = () => reject(tx.error || new Error('事务中止'));
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch((err) => {
        reject(err);
        try {
          tx.abort();
        } catch (_) {
          /* 已经结束 */
        }
      });
  });
}

export function putSession(session) {
  return withStore('sessions', 'readwrite', (store) => requestToPromise(store.put(session)));
}

export function deleteSession(id) {
  return withStore('sessions', 'readwrite', (store) => requestToPromise(store.delete(id)));
}

export function getAllSessions() {
  return withStore('sessions', 'readonly', (store) => requestToPromise(store.getAll()));
}

// 未完成的训练草稿（最多应有一条；有多条时取最近开始的）。
// test=true 只找 ?date= 测试模式建的草稿，false 只找真实训练，两者互不干扰。
export async function findDraft({ test = false } = {}) {
  const all = await getAllSessions();
  const drafts = all.filter((s) => !s.finishedAt && Boolean(s.test) === test);
  drafts.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return drafts[0] || null;
}

export function getSetting(key) {
  return withStore('settings', 'readonly', (store) => requestToPromise(store.get(key))).then((row) =>
    row ? row.value : undefined
  );
}

export function putSetting(key, value) {
  return withStore('settings', 'readwrite', (store) => requestToPromise(store.put({ key, value })));
}

// 申请持久存储（spec 2.5）：支持的话系统存储紧张时也不清这个站的数据。失败不影响使用。
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) {
    /* 忽略 */
  }
  return false;
}
