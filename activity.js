// activity.js — 打球 / 有氧 / 散步记录（spec 2.3 的 ball / cardio 记录）和"本周"统计。纯函数。
import { toDateKey, parseDateKey } from './schedule.js';

// 一条非力量记录：kind 'ball' | 'cardio' | 'walk'；cardioId 是 cardioTemplates 里的 id（ball / zone2-30 / walk …）
export function createActivitySession({ kind, cardioId, dateKey, now, minutes, avgHr = null, zone3Min = null, note = '' }) {
  const mins = Math.max(1, Math.round(minutes));
  return {
    id: `${dateKey}-${kind}-${now}`,
    date: dateKey,
    templateId: null,
    cardioId: cardioId || null,
    activityKind: kind === 'walk' ? 'cardio' : kind, // spec 2.3 只有 strength | cardio | ball | rest；散步算 cardio
    startedAt: now - mins * 60000,
    finishedAt: now,
    entries: [],
    cardio: { minutes: mins, avgHr, zone3Min, note: note || null },
  };
}

export function isActivity(session) {
  return session.activityKind === 'ball' || session.activityKind === 'cardio';
}

// 本周（周一到周日）的日期 key 列表，date 是"今天"
export function weekDateKeys(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // 周一 = 0
  d.setDate(d.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => toDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
}

// 本周每天的记录摘要：{ key, done: boolean, ball: boolean, strength: boolean }
export function weekSummary(sessions, date) {
  const keys = weekDateKeys(date);
  return keys.map((key) => {
    const todays = sessions.filter((s) => s.finishedAt && s.date === key);
    return {
      key,
      done: todays.length > 0,
      ball: todays.some((s) => s.activityKind === 'ball'),
      strength: todays.some((s) => s.activityKind === 'strength'),
    };
  });
}

// 本周打球次数（软校验上限 3）
export function ballCountThisWeek(sessions, date) {
  const keys = new Set(weekDateKeys(date));
  return sessions.filter((s) => s.finishedAt && s.activityKind === 'ball' && keys.has(s.date)).length;
}

export const BALL_WEEKLY_LIMIT = 3;

// 某天已记录的非力量活动（给首页"今天已记录"用）
export function activitiesOn(sessions, dateKey) {
  return sessions.filter((s) => s.finishedAt && s.date === dateKey && isActivity(s));
}

// 显示名："羽毛球 60 分钟 · 平均心率 135 · Zone3+ 10 分钟"
export function describeActivity(session, plan) {
  const t = (plan.cardioTemplates || []).find((c) => c.id === session.cardioId);
  // 模板名里自带的"30 分钟"去掉，按实际填的时长显示
  const name = (t ? t.name : session.activityKind === 'ball' ? '打球' : '有氧').replace(/\s*\d+(?:-\d+)?\s*分钟$/, '');
  const c = session.cardio || {};
  const parts = [`${name} ${c.minutes} 分钟`];
  if (c.avgHr != null) parts.push(`平均心率 ${c.avgHr}`);
  if (c.zone3Min != null) parts.push(`Zone3+ ${c.zone3Min} 分钟`);
  if (c.note) parts.push(c.note);
  return parts.join(' · ');
}

export { parseDateKey };
