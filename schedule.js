// schedule.js — 从训练计划解析"某一天练什么"。纯函数，不碰 DOM，不读时钟。

import { formatWeight } from './units.js';

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 本地日期 → 'YYYY-MM-DD'。不用 toISOString()，那会按 UTC 算，晚上会跳到第二天。
export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// 'YYYY-MM-DD' → 本地午夜的 Date。格式不对或日期不存在（如 02-30）返回 null。
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

function findDayTemplate(plan, id) {
  return (plan.dayTemplates || []).find((t) => t.id === id) || null;
}

function findCardioTemplate(plan, id) {
  return (plan.cardioTemplates || []).find((c) => c.id === id) || null;
}

/**
 * 解析某天的安排。优先级：overrides（按日期）→ weeklySchedule（按星期）。
 *
 * 返回对象：
 *   dateKey, weekday(0=周日), weekdayLabel, source: 'override' | 'weekly' | 'none'
 *   kind: 'strength' | 'ballOptional' | 'cardio' | 'rest' | 'unknown'
 *   title              首页大标题
 *   day                kind==='strength' 时的训练日模板
 *   cardio             kind==='cardio' 时的有氧模板
 *   fallback           kind==='ballOptional' 时"不打球做什么"的有氧模板（可能为 null）
 *   ballOptional       休息日可以打球（周日）
 *   disabledTemplate   原本安排的训练日模板被停用（上肢B 未启用）时放这里，用于提示
 *   note               override / weeklySchedule 上的备注
 *   problems           数据问题列表（找不到模板等），显示出来而不是静默
 */
export function resolveDay(plan, date) {
  const dateKey = toDateKey(date);
  const weekday = date.getDay();
  const weekdayLabel = WEEKDAY_LABELS[weekday];
  const problems = [];

  const override = (plan.overrides || []).find((o) => o.date === dateKey) || null;
  const weekly = (plan.weeklySchedule || []).find((w) => w.weekday === weekday) || null;

  let source = 'none';
  let ref = null;
  let fallbackRef = null;
  let note = null;
  let ballOptional = false;

  if (override) {
    source = 'override';
    ref = override.plan || null;
    if (!ref) problems.push(`调课记录 ${dateKey} 缺少 plan`);
    fallbackRef = override.fallback || null;
    note = override.note || null;
    ballOptional = Boolean(override.ballOptional);
  } else if (weekly) {
    source = 'weekly';
    ref = weekly.primary || null;
    if (!ref) problems.push(`${weekdayLabel} 的每周安排缺少 primary`);
    fallbackRef = weekly.fallback || null;
    note = weekly.note || null;
    ballOptional = Boolean(weekly.ballOptional);
  } else {
    problems.push('计划里没有这一天的安排，按休息处理');
  }

  const base = {
    dateKey,
    weekday,
    weekdayLabel,
    source,
    kind: 'rest',
    title: '休息 / 散步',
    day: null,
    cardio: null,
    fallback: null,
    ballOptional,
    disabledTemplate: null,
    note,
    problems,
  };

  const fallbackCardio = fallbackRef && fallbackRef.type === 'cardio' ? findCardioTemplate(plan, fallbackRef.id) : null;
  if (fallbackRef && fallbackRef.type === 'cardio' && !fallbackCardio) {
    problems.push(`找不到有氧模板 ${fallbackRef.id}`);
  }

  if (!ref) {
    // 没有这一天的安排 → 休息；有记录但缺 plan/primary → 显示"安排有误"而不是假装休息
    return source === 'none' ? base : { ...base, kind: 'unknown', title: '安排有误' };
  }
  if (ref.type === 'rest') {
    return base;
  }

  if (ref.type === 'day') {
    const template = findDayTemplate(plan, ref.id);
    if (!template) {
      problems.push(`找不到训练日模板 ${ref.id}`);
      return { ...base, kind: 'unknown', title: '安排有误' };
    }
    if (template.enabled === false) {
      // 上肢B 未启用：周四只做二区（spec 3.1）
      if (fallbackCardio) {
        return { ...base, kind: 'cardio', title: fallbackCardio.name, cardio: fallbackCardio, disabledTemplate: template };
      }
      return { ...base, kind: 'rest', title: '休息 / 散步', disabledTemplate: template };
    }
    return { ...base, kind: 'strength', title: template.name, day: template };
  }

  if (ref.type === 'cardio') {
    const template = findCardioTemplate(plan, ref.id);
    if (!template) {
      problems.push(`找不到有氧模板 ${ref.id}`);
      return { ...base, kind: 'unknown', title: '安排有误' };
    }
    return { ...base, kind: 'cardio', title: template.name, cardio: template };
  }

  if (ref.type === 'ballOptional') {
    return { ...base, kind: 'ballOptional', title: '可选打球', fallback: fallbackCardio };
  }

  problems.push(`不认识的安排类型 ${ref.type}`);
  return { ...base, kind: 'unknown', title: '安排有误' };
}

// 重量显示：优先用 label 原文（"120 每边"、"37.5 助力"、"自重"），否则拼 value + unit；null 表示第一次做时填。
export function formatLoad(load) {
  if (!load) return '';
  if (load.label) return load.label;
  if (load.bodyweight) return '自重';
  if (load.value == null) return '首次做时填';
  return formatWeight(load.value);
}

export function formatRange(range) {
  if (!range) return '?';
  const { min, max } = range;
  if (min == null && max == null) return '?';
  if (min == null || max == null || min === max) return String(max ?? min);
  return `${min}–${max}`;
}

// 组数 × 次数，如 "3 × 6–10"、"2–3 × 10–15"；每侧动作加"每侧"；按距离计的动作（countUnit 'm'）加"米"。
export function formatSetsReps(exercise) {
  const unit = exercise.countUnit === 'm' ? ' 米' : '';
  const text = `${formatRange(exercise.sets)} × ${formatRange(exercise.reps)}${unit}`;
  return exercise.perSide ? `${text} 每侧` : text;
}

// 有氧模板的一行说明："坡度快走 / 骑行 · 30 分钟 · 心率 120–140"
export function formatCardio(cardio) {
  if (!cardio) return '';
  const parts = [];
  if (Array.isArray(cardio.modality) && cardio.modality.length) parts.push(cardio.modality.join(' / '));
  const dur = cardio.durationMin;
  if (typeof dur === 'number') parts.push(`${dur} 分钟`);
  else if (dur && typeof dur === 'object') parts.push(`${formatRange(dur)} 分钟`);
  const hr = cardio.heartRate;
  if (hr && (hr.min != null || hr.max != null)) parts.push(`心率 ${formatRange(hr)}`);
  return parts.join(' · ');
}
