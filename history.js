// history.js — 从已完成的训练里找"上次做这个动作"的数据。纯函数，不碰数据库。
import { formatWeight, otherUnitText } from './units.js';
import { currentExerciseId, setExerciseId } from './exercise-library.js';

// 一次训练里某个动作实际做的全部组（按动作库 id：不管它在这天是主动作还是替代动作）
export function setsOfExercise(session, exerciseId) {
  const out = [];
  for (const e of session.entries || []) for (const set of e.sets || []) if (setExerciseId(set, e) === exerciseId) out.push(set);
  return out;
}

// 上一次做某个动作的各组：{ sessionId, date, sets: [{weight, reps}] }，没有返回 null。
// 按实际做的动作查（动作库 id），哪天练的、是不是作为替代动作做的都算。
// sessions：listSessions 的结果（按 startedAt 倒序）；excludeId：当前这次训练，不算"上次"。
export function lastSetsFor(sessions, exerciseId, excludeId) {
  for (const s of sessions) {
    if (!s.finishedAt || s.id === excludeId) continue;
    const sets = setsOfExercise(s, exerciseId);
    if (sets.length === 0) continue;
    return {
      sessionId: s.id,
      date: s.date,
      sets: sets.map((set) => ({ weight: set.weight ?? null, reps: set.reps ?? null })),
    };
  }
  return null;
}

// 显示用："105×8 · 105×8 · 105×7"；缺的值用 "?"（自重动作重量为 null，只显示次数）。
// countUnit 'm'：按距离计的动作，次数后面带 m（"50×25m"）；dual：磅数后面带公斤（历史里用）"105×8 (47.6 kg)"
export function formatSets(sets, { bodyweight = false, countUnit = null, dual = false } = {}) {
  const suffix = countUnit === 'm' ? 'm' : '';
  return sets
    .map((set) => {
      const reps = set.reps == null ? '?' : `${set.reps}${suffix}`;
      if (bodyweight) return `${reps}`;
      const weight = set.weight == null ? '?' : formatWeight(set.weight, { withUnit: false });
      const other = dual && set.weight != null ? ` (${otherUnitText(set.weight)})` : '';
      return `${weight}×${reps}${other}`;
    })
    .join(' · ');
}

// 下一组的预填值（spec 3.2 + 2026-10-24 的决定）：
//   重量：本次上一组（这次已经调过的重量优先，直线组模型）→ 上次同组数 → 上次最后一组 → 计划值（null = 必填）
//   次数：本次上一组的次数（2026-10-26 用户要求：同一动作下一组沿用上一组，不重置）→ 上次同组数的次数 → 区间上限
// "本次上一组"和"同组数"只看当前实际在做的动作的组：中途换了替代动作，别的动作的重量不作参考，组数也不错位
export function prefillFor(entry, exercise, last) {
  const wanted = currentExerciseId(entry);
  const same = (entry.sets || []).filter((s) => setExerciseId(s, entry) === wanted);
  const idx = same.length;
  const prev = same[same.length - 1] || null;
  const lastSets = last ? last.sets : [];
  const load = exercise.load || {};
  const weight = load.bodyweight
    ? null
    : (prev?.weight ?? lastSets[idx]?.weight ?? lastSets[lastSets.length - 1]?.weight ?? load.value ?? null);
  const reps = prev?.reps ?? lastSets[idx]?.reps ?? (exercise.reps || {}).max ?? null;
  return { weight, reps };
}
