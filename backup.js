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

/* ---------- 备份提醒（按日期：超过 14 天没备份且期间有新训练就提醒；用户决定，代替 spec 2.5 的"每 10 次"） ---------- */

export const BACKUP_REMIND_DAYS = 14;
export const BACKUP_SNOOZE_DAYS = 7;
const DAY_MS = 86400000;

// settings 表 key='backup'：{ lastCount: 上次导出时的已完成训练数, lastAt: 上次导出时间 | null, snoozedUntil: "稍后再说"推迟到的时间 | null }
export function normalizeBackupMeta(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = Number(r.lastCount);
  const at = Number(r.lastAt);
  const until = Number(r.snoozedUntil);
  return {
    lastCount: Number.isInteger(n) && n >= 0 ? n : 0,
    lastAt: Number.isFinite(at) && at > 0 ? at : null,
    snoozedUntil: Number.isFinite(until) && until > 0 ? until : null,
  };
}

function earliestFinishedAt(sessions) {
  let min = null;
  for (const s of sessions) {
    if (!s.finishedAt || (s.activityKind && s.activityKind !== 'strength')) continue;
    if (min == null || s.finishedAt < min) min = s.finishedAt;
  }
  return min;
}

// 已完成的力量训练数：打球 / 有氧 / 散步是"记录"，不算"训练"
export function finishedTrainingCount(sessions) {
  return sessions.filter((s) => s.finishedAt && (!s.activityKind || s.activityKind === 'strength')).length;
}

// days：距上次备份几天（没备份过就从第一次完成训练算起）；since：上次备份之后又完成了几次。
// 到期 = 满 14 天 且 期间有新训练 且 没在"稍后再说"的推迟期内。
export function backupReminder(sessions, meta, now) {
  const finished = finishedTrainingCount(sessions);
  const since = Math.max(0, finished - meta.lastCount);
  const ref = meta.lastAt ?? earliestFinishedAt(sessions);
  const days = ref == null ? null : Math.max(0, Math.floor((now - ref) / DAY_MS));
  const snoozed = meta.snoozedUntil != null && now < meta.snoozedUntil;
  const due = since > 0 && days != null && days >= BACKUP_REMIND_DAYS && !snoozed;
  return { finished, since, days, snoozed, due };
}
