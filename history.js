// history.js — 从已完成的训练里找"上次做这个动作"的数据。纯函数，不碰数据库。

// 上一次做某个动作（同一替代动作口径）的各组：{ sessionId, date, sets: [{weight, reps}] }，没有返回 null。
// sessions：listSessions 的结果（按 startedAt 倒序）；excludeId：当前这次训练，不算"上次"。
export function lastSetsFor(sessions, exerciseId, usedAlternate, excludeId) {
  const wanted = usedAlternate ?? null;
  for (const s of sessions) {
    if (!s.finishedAt || s.id === excludeId) continue;
    const entry = (s.entries || []).find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    const sets = (entry.sets || []).filter((set) => (set.usedAlternate ?? null) === wanted);
    if (sets.length === 0) continue;
    return {
      sessionId: s.id,
      date: s.date,
      sets: sets.map((set) => ({ weight: set.weight ?? null, reps: set.reps ?? null })),
    };
  }
  return null;
}

// 显示用："105×8 · 105×8 · 105×7"；缺的值用 "?"（自重动作重量为 null，只显示次数）
export function formatSets(sets, { bodyweight = false } = {}) {
  return sets
    .map((set) => {
      const reps = set.reps == null ? '?' : set.reps;
      if (bodyweight) return `${reps}`;
      const weight = set.weight == null ? '?' : set.weight;
      return `${weight}×${reps}`;
    })
    .join(' · ');
}

// 下一组的预填值（spec 3.2 + 2026-10-24 的决定）：
//   重量：本次上一组（这次已经调过的重量优先，直线组模型）→ 上次同组数 → 上次最后一组 → 计划值（null = 必填）
//   次数：上次同组数的次数 → 区间上限（严格按 spec）
// "本次上一组"和"同组数"只看当前替代动作口径下的组：中途换了替代动作，别的动作的重量不作参考，组数也不错位
export function prefillFor(entry, exercise, last) {
  const wanted = entry.usedAlternate ?? null;
  const same = (entry.sets || []).filter((s) => (s.usedAlternate ?? null) === wanted);
  const idx = same.length;
  const prev = same[same.length - 1] || null;
  const lastSets = last ? last.sets : [];
  const load = exercise.load || {};
  const weight = load.bodyweight
    ? null
    : (prev?.weight ?? lastSets[idx]?.weight ?? lastSets[lastSets.length - 1]?.weight ?? load.value ?? null);
  const reps = lastSets[idx]?.reps ?? (exercise.reps || {}).max ?? null;
  return { weight, reps };
}
