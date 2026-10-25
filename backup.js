// backup.js — 导出 / 导入 JSON 的纯函数（spec 2.5）。文件格式：
// { app: 'workout-tracker', format: 1, exportedAt, plan, settings, sessions: [...] }
// 导出的文件可读可手改（spec 4），导入时尽量宽容：只认得出来的部分才用，坏了就报错不动数据。
import { toDateKey } from './schedule.js';
import { normalizeSettings } from './settings.js';

export const BACKUP_APP = 'workout-tracker';
export const BACKUP_FORMAT = 1;

export function buildBackup({ plan, settings, sessions, now }) {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: new Date(now).toISOString(),
    plan,
    settings,
    sessions,
  };
}

export function backupFileName(now) {
  return `workout-backup-${toDateKey(new Date(now))}.json`;
}

function isPlan(p) {
  return p && typeof p === 'object' && Array.isArray(p.dayTemplates) && Array.isArray(p.weeklySchedule);
}

// 返回 { ok: true, data: { plan|null, settings|null, sessions }, summary } 或 { ok: false, error }
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '文件内容不是备份对象' };
  if (raw.app !== undefined && raw.app !== BACKUP_APP) return { ok: false, error: `这不是本 App 的备份（app = ${String(raw.app)}）` };
  const sessions = raw.sessions === undefined ? [] : raw.sessions;
  if (!Array.isArray(sessions)) return { ok: false, error: 'sessions 不是数组' };
  for (const s of sessions) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !s.id) return { ok: false, error: '有记录缺少 id' };
    if (!Array.isArray(s.entries) && s.activityKind !== 'ball' && s.activityKind !== 'cardio') return { ok: false, error: `记录 ${s.id} 缺少 entries` };
  }
  let plan = null;
  if (raw.plan !== undefined && raw.plan !== null) {
    if (!isPlan(raw.plan)) return { ok: false, error: 'plan 不完整（要有 dayTemplates 和 weeklySchedule）' };
    plan = raw.plan;
  }
  const settings = raw.settings && typeof raw.settings === 'object' ? normalizeSettings(raw.settings) : null;
  if (!plan && !settings && sessions.length === 0) return { ok: false, error: '文件里没有计划、设置或记录' };
  return {
    ok: true,
    data: { plan, settings, sessions },
    summary: {
      sessions: sessions.length,
      finished: sessions.filter((s) => s.finishedAt).length,
      plan: Boolean(plan),
      settings: Boolean(settings),
    },
  };
}

// 合并：按 id 去重，同一条以导入的为准；其余保留
export function mergeSessions(existing, imported) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of imported) byId.set(s.id, s);
  return [...byId.values()];
}

/* ---------- 备份提醒（spec 2.5：每完成 10 次训练提醒一次） ---------- */

export const BACKUP_REMIND_EVERY = 10;

// settings 表 key='backup'：{ lastCount: 上次备份 / 上次按"稍后再说"时的已完成训练数, lastAt: 上次导出时间 | null }
export function normalizeBackupMeta(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = Number(r.lastCount);
  const at = Number(r.lastAt);
  return {
    lastCount: Number.isInteger(n) && n >= 0 ? n : 0,
    lastAt: Number.isFinite(at) && at > 0 ? at : null,
  };
}

// 已完成的力量训练数：打球 / 有氧 / 散步是"记录"，不算"训练"
export function finishedTrainingCount(sessions) {
  return sessions.filter((s) => s.finishedAt && (!s.activityKind || s.activityKind === 'strength')).length;
}

// since：上次备份（或上次"稍后再说"）之后又完成了几次；满 10 次就该提醒
export function backupReminder(sessions, meta) {
  const finished = finishedTrainingCount(sessions);
  const since = Math.max(0, finished - meta.lastCount);
  return { finished, since, due: since >= BACKUP_REMIND_EVERY };
}
