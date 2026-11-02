// skip-day.js — "这天不练"的三种处理（用户要求，spec 之外）。纯函数，只产出新的计划（用 overrides 表达）。
//   跳过：这天改成休息，后面不动。
//   顺延：这天改成休息，后面的训练 / 有氧依次往后挪一天，打球日和休息日位置不动，挪到下一个休息日为止（那个休息日被占掉）。
//   压缩打球日：这天改成休息，挑一个之后的可选打球日，那天改成这天原本的训练（那天不打球）。
import { resolveDay, toDateKey, WEEKDAY_LABELS } from './schedule.js';
import { upsertOverride } from './plan-edit.js';

const DAY_MS = 86400000;
export const SHIFT_HORIZON_DAYS = 14;

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function fmtDay(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAY_LABELS[date.getDay()]}`;
}

// 解析结果 → upsertOverride 用的安排对象；安排有误的返回 null
export function assignmentOfDay(day) {
  if (day.kind === 'strength') return { type: 'day', id: day.day.id, fallbackId: null, ballOptional: false, note: '' };
  if (day.kind === 'cardio') return { type: 'cardio', id: day.cardio.id, fallbackId: null, ballOptional: false, note: '' };
  if (day.kind === 'ballOptional') return { type: 'ballOptional', id: null, fallbackId: day.fallback ? day.fallback.id : null, ballOptional: false, note: '' };
  if (day.kind === 'rest') return { type: 'rest', id: null, fallbackId: null, ballOptional: Boolean(day.ballOptional), note: '' };
  return null;
}

const REST = (note) => ({ type: 'rest', id: null, fallbackId: null, ballOptional: false, note });

// 这天能不能"不练"：力量 / 有氧 / 可选打球都可以，休息日没意义
export function canSkip(day) {
  return day.kind === 'strength' || day.kind === 'cardio' || day.kind === 'ballOptional';
}

// 顺延的预览：[{ from: Date, to: Date, title }]，consumedRest：被占掉的休息日（找不到就 null，此时挪满 14 天）
export function shiftPreview(plan, date) {
  const moves = [];
  let carry = resolveDay(plan, date); // 要往后挪的那一天的安排
  let carryDate = date;
  let consumedRest = null;
  for (let i = 1; i <= SHIFT_HORIZON_DAYS; i++) {
    const d = addDays(date, i);
    const here = resolveDay(plan, d);
    if (here.kind === 'ballOptional' || here.kind === 'unknown') continue; // 打球日不动，也不往上放
    if (here.kind === 'rest') {
      moves.push({ from: carryDate, to: d, title: carry.title });
      consumedRest = d;
      break;
    }
    moves.push({ from: carryDate, to: d, title: carry.title });
    carry = here;
    carryDate = d;
  }
  return { moves, consumedRest };
}

// 之后 14 天里的可选打球日（压缩用）
export function upcomingBallDays(plan, date) {
  const out = [];
  for (let i = 1; i <= SHIFT_HORIZON_DAYS; i++) {
    const d = addDays(date, i);
    const day = resolveDay(plan, d);
    if (day.kind === 'ballOptional') out.push({ date: d, dateKey: day.dateKey, label: fmtDay(d) });
  }
  return out;
}

// mode: 'skip' | 'shift' | 'compress'（compress 要带 ballDateKey）。返回 { plan, summary } 或 { error }
export function applySkip(plan, date, mode, { ballDateKey } = {}) {
  const day = resolveDay(plan, date);
  if (!canSkip(day)) return { error: '这天本来就是休息' };
  const dateKey = toDateKey(date);
  if (mode === 'skip') {
    return { plan: upsertOverride(plan, dateKey, REST(`不练（跳过 ${day.title}）`)), summary: `${fmtDay(date)} 改成休息，后面不变` };
  }
  if (mode === 'shift') {
    const { moves, consumedRest } = shiftPreview(plan, date);
    if (!moves.length) return { error: '后面 14 天里没有可以挪的日子' };
    let next = plan;
    // 先按原计划把每天的安排算好，再写 overrides，免得写一半影响后面的解析
    const assigns = moves.map((m) => ({ to: toDateKey(m.to), assign: assignmentOfDay(resolveDay(plan, m.from)) }));
    for (const a of assigns) {
      if (a.assign) next = upsertOverride(next, a.to, a.assign);
    }
    next = upsertOverride(next, dateKey, REST(`不练（${day.title} 顺延）`));
    const last = moves[moves.length - 1];
    return {
      plan: next,
      summary: consumedRest ? `${fmtDay(date)} 改成休息，后面的训练各往后挪一天，${fmtDay(consumedRest)} 的休息被占掉` : `${fmtDay(date)} 改成休息，后面 14 天的训练各往后挪一天（${fmtDay(last.from)} 的 ${last.title} 挪出了范围）`,
    };
  }
  if (mode === 'compress') {
    const ball = upcomingBallDays(plan, date).find((b) => b.dateKey === ballDateKey);
    if (!ball) return { error: '先选一个打球日' };
    const assign = assignmentOfDay(day);
    if (!assign) return { error: '这天的安排有误，没法挪' };
    let next = upsertOverride(plan, ball.dateKey, { ...assign, note: `${day.title} 从 ${fmtDay(date)} 压缩过来，这天不打球` });
    next = upsertOverride(next, dateKey, REST(`不练（${day.title} 压缩到 ${ball.label}）`));
    return { plan: next, summary: `${fmtDay(date)} 改成休息，${ball.label} 不打球改练 ${day.title}` };
  }
  return { error: '不认识的处理方式' };
}

/* ---------- 排程规则冲突检查（只检查，不阻止；用户决定） ---------- */

const isLegs = (day) => day.kind === 'strength' && (day.day.id === 'legs' || /腿/.test(day.day.name));
const isPush = (day) => day.kind === 'strength' && (day.day.id === 'push' || /推日/.test(day.day.name));
const isUpperB = (day) => day.kind === 'strength' && (day.day.id === 'upperB' || /上肢B/.test(day.day.name));
const isBall = (day) => day.kind === 'ballOptional';
const isCardio = (day) => day.kind === 'cardio' || (day.kind === 'strength' && Boolean(day.day.cardio)); // 上肢B 后面接二区也算

// 从 startDate 起 days 天里相邻两天的冲突：[{ dateKey, text }]。规则来自 training-plan.json 的 rules：
//   腿日和球之间至少隔 1 天 / 球的次日不排腿日；推日和上肢B 之间至少隔 1 天；
//   同一肌群 48 小时（按同一训练日模板连续两天算）；二区不要放在重腿日前一天
export function ruleConflicts(plan, startDate, days = 15) {
  const seq = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(startDate, i);
    seq.push({ d, day: resolveDay(plan, d) });
  }
  const out = [];
  const push = (b, text) => out.push({ dateKey: b.day.dateKey, text });
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i];
    const b = seq[i + 1];
    const pair = `${fmtDay(a.d)} ${a.day.title} 和 ${fmtDay(b.d)} ${b.day.title} 挨着`;
    if ((isLegs(a.day) && isBall(b.day)) || (isBall(a.day) && isLegs(b.day))) push(b, `${pair}：腿日和球要隔一天`);
    if ((isPush(a.day) && isUpperB(b.day)) || (isUpperB(a.day) && isPush(b.day))) push(b, `${pair}：推日和上肢B 要隔一天`);
    if (a.day.kind === 'strength' && b.day.kind === 'strength' && a.day.day.id === b.day.day.id) push(b, `${pair}：同一肌群要隔 48 小时`);
    if (isCardio(a.day) && isLegs(b.day)) push(b, `${pair}：二区不要放在重腿日前一天`);
  }
  return out;
}

// 处理方案带来的新冲突（原计划里本来就有的不算）
export function newConflicts(plan, nextPlan, date) {
  const before = new Set(ruleConflicts(plan, addDays(date, -1)).map((c) => c.text));
  return ruleConflicts(nextPlan, addDays(date, -1)).filter((c) => !before.has(c.text));
}

export { DAY_MS };
