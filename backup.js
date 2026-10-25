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
