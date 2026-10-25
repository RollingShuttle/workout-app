// progression.js — 进阶 / 退阶提示（spec 3.4）。只提示，不改计划。纯函数。
//   进阶：最近两次已完成训练里，这个动作所有组都做到 reps.max → 可以加重（上肢 +5，腿日 +10，引体助力 −5）
//   退阶：最近两次都有组低于 reps.min → 下次减一组
// 只看原动作 / 同一替代动作口径的组，且两次都把每组次数记全了（旧记录没记次数的不算）。

// 最近 n 次做过这个动作、次数记全的已完成训练，最新在前：[{ date, sets: [{ weight, reps }] }]
export function recentSessionsFor(sessions, exerciseId, usedAlternate, excludeId, n = 2) {
  const wanted = usedAlternate ?? null;
  const out = [];
  for (const s of sessions) {
    if (!s.finishedAt || s.id === excludeId) continue;
    const entry = (s.entries || []).find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const sets = (entry.sets || []).filter((set) => (set.usedAlternate ?? null) === wanted);
    if (!sets.length || sets.some((set) => typeof set.reps !== 'number')) continue;
    out.push({ date: s.date, sets: sets.map((set) => ({ weight: set.weight ?? null, reps: set.reps })) });
    if (out.length >= n) break;
  }
  return out;
}

export function incrementFor(exercise, templateId, increments = {}) {
  const load = exercise.load || {};
  if (load.assisted) return increments.assistedPullUp ?? -5;
  if (templateId === 'legs') return increments.lowerMachine ?? 10;
  return increments.upper ?? 5;
}

export function suggestionFor({ exercise, entry, templateId, sessions, excludeId, increments }) {
  const reps = exercise.reps || {};
  if (reps.max == null || reps.min == null) return null;
  const recent = recentSessionsFor(sessions, exercise.id, entry ? entry.usedAlternate : null, excludeId, 2);
  if (recent.length < 2) return null;
  const allAtMax = recent.every((s) => s.sets.every((set) => set.reps >= reps.max));
  const anyBelowMin = recent.every((s) => s.sets.some((set) => set.reps < reps.min));
  const load = exercise.load || {};
  if (allAtMax && !load.bodyweight) {
    const delta = incrementFor(exercise, templateId, increments);
    const text = load.assisted
      ? `上两次都做满 ${reps.max} 次，可以把助力减 ${Math.abs(delta)} lb`
      : `上两次都做满 ${reps.max} 次，可以加重 +${delta} lb`;
    return { kind: 'up', delta, text };
  }
  if (allAtMax && load.bodyweight) {
    return { kind: 'up', delta: 0, text: `上两次都做满 ${reps.max} 次，可以加难度或加负重` };
  }
  if (anyBelowMin) {
    return { kind: 'down', delta: 0, text: `上两次都有组低于 ${reps.min} 次，下次减一组` };
  }
  return null;
}
