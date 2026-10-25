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
      // iOS 后台挂起后系统可能直接断掉连接：丢掉缓存的连接，下次操作重新打开
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('打开数据库失败'));
    // blocked 不是失败：别的页面还没关连接，关了之后这个 open 仍会 success，所以这里只等
    req.onblocked = () => {};
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

async function withStore(storeName, mode, fn, retried = false) {
  const db = await openDb();
  let tx;
  try {
    tx = db.transaction(storeName, mode);
  } catch (err) {
    // 连接已经被关掉（iOS 后台回来后常见，报 InvalidStateError）：重开一次再试
    if (!retried) {
      dbPromise = null;
      try {
        db.close();
      } catch (_) {
        /* 已关 */
      }
      return withStore(storeName, mode, fn, true);
    }
    throw err;
  }
  return new Promise((resolve, reject) => {
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

// 全表读取只在本文件内用；外部一律走 listSessions / findDraft，
// 保证 ?date= 测试模式的记录（test:true）和真实训练永远分开。
function getAllSessions() {
  return withStore('sessions', 'readonly', (store) => requestToPromise(store.getAll()));
}

// 某一模式下的全部训练（含草稿），按开始时间倒序。以后历史列表、导出、备份提醒计数都从这里读。
export async function listSessions({ test = false } = {}) {
  const all = await getAllSessions();
  const rows = all.filter((s) => Boolean(s.test) === test);
  rows.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return rows;
}

// 未完成的训练草稿（最多应有一条；有多条时取最近开始的）。
export async function findDraft({ test = false } = {}) {
  const rows = await listSessions({ test });
  return rows.find((s) => !s.finishedAt) || null;
}

// settings 表：key → value。现在只放 'plan'（整份训练计划）。
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
