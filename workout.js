// workout.js — 一次训练的状态逻辑。纯函数：不碰 DOM、不读时钟，时间由调用方传入（毫秒时间戳）。
// 数据形状对应 spec 2.3 的 WorkoutSession；本步骤只做计数，重量/次数输入在 Phase 2。

export function createSession(template, dateKey, now) {
  return {
    id: `${dateKey}-${template.id}-${now}`,
    date: dateKey,
    templateId: template.id,
    activityKind: 'strength',
    startedAt: now,
    finishedAt: null,
    activeExerciseId: null,
    lastSetCompletedAt: null, // 组间秒表只靠这个时间戳
    entries: (template.exercises || []).map((ex) => ({
      exerciseId: ex.id,
      usedAlternate: null,
      sets: [],
      status: 'pending', // pending | active | done
      extraSets: 0, // "再加一组"累计
    })),
  };
}

export function findExercise(template, id) {
  return (template.exercises || []).find((ex) => ex.id === id) || null;
}

export function findEntry(session, id) {
  return session.entries.find((e) => e.exerciseId === id) || null;
}

// 目标组数 = sets.max（spec 2.2）+ 再加的组
export function targetSets(exercise, entry) {
  const sets = exercise.sets || {};
  const base = sets.max ?? sets.min ?? 1;
  return base + (entry ? entry.extraSets : 0);
}

// 已完成组数：每侧动作左右各一次才算一组
export function completedSets(entry, exercise) {
  return exercise.perSide ? Math.floor(entry.sets.length / 2) : entry.sets.length;
}

// 每侧动作下一次该做哪边；非每侧动作返回 null
export function nextSide(entry, exercise) {
  if (!exercise.perSide) return null;
  return entry.sets.length % 2 === 0 ? 'L' : 'R';
}

export function isDone(entry, exercise) {
  return completedSets(entry, exercise) >= targetSets(exercise, entry);
}

function plannedWeight(exercise) {
  const load = exercise.load || {};
  return load.value ?? null;
}

function latestCompletedAt(entries) {
  let latest = null;
  for (const e of entries) {
    for (const s of e.sets) {
      if (latest == null || s.completedAt > latest) latest = s.completedAt;
    }
  }
  return latest;
}

// 把 id 设为进行中，其他进行中的回到待做；已完成的动作点击无反应
function activate(session, id, patch) {
  return {
    ...session,
    activeExerciseId: id,
    entries: session.entries.map((e) => {
      if (e.exerciseId === id) return { ...e, ...patch, status: 'active' };
      if (e.status === 'active') return { ...e, status: 'pending' };
      return e;
    }),
  };
}

export function selectExercise(session, template, id) {
  const entry = findEntry(session, id);
  if (!entry || !findExercise(template, id) || entry.status === 'done') return session;
  if (session.activeExerciseId === id) return session;
  return activate(session, id, {});
}

// 完成一组：记一条 set；达到目标组数 → 完成、清空进行中
export function completeSet(session, template, id, now) {
  const entry = findEntry(session, id);
  const exercise = findExercise(template, id);
  if (!entry || !exercise || entry.status === 'done') return session;

  const side = nextSide(entry, exercise);
  const setNo = exercise.perSide ? Math.floor(entry.sets.length / 2) + 1 : entry.sets.length + 1;
  const restTakenSeconds =
    session.lastSetCompletedAt == null ? null : Math.max(0, Math.round((now - session.lastSetCompletedAt) / 1000));
  const set = { setNo, weight: plannedWeight(exercise), reps: null, completedAt: now, restTakenSeconds };
  if (side) set.side = side;

  const updated = { ...entry, sets: [...entry.sets, set] };
  const done = isDone(updated, exercise);
  const next = activate(session, id, updated);
  if (done) {
    return {
      ...next,
      lastSetCompletedAt: now,
      activeExerciseId: null,
      entries: next.entries.map((e) => (e.exerciseId === id ? { ...e, status: 'done' } : e)),
    };
  }
  return { ...next, lastSetCompletedAt: now };
}

// "再加一组"之后、那一组还没开始做：此时撤销 = 取消加组，回到完成态，不删真实记录
export function canCancelExtraSet(entry, exercise) {
  if (!entry || entry.extraSets <= 0) return false;
  if (exercise.perSide && entry.sets.length % 2 !== 0) return false; // 左侧已做、右侧没做，不算"还没开始"
  return completedSets(entry, exercise) === targetSets(exercise, entry) - 1;
}

// 撤销最后一组：从完成态拉回进行中；刚加的那组还没做时改为取消加组；没有组可撤时无反应
export function undoLastSet(session, template, id) {
  const entry = findEntry(session, id);
  const exercise = findExercise(template, id);
  if (!entry || !exercise) return session;
  if (canCancelExtraSet(entry, exercise)) {
    return {
      ...session,
      activeExerciseId: session.activeExerciseId === id ? null : session.activeExerciseId,
      // lastSetCompletedAt 不动：没有删任何真实记录
      entries: session.entries.map((e) =>
        e.exerciseId === id ? { ...e, extraSets: e.extraSets - 1, status: 'done' } : e
      ),
    };
  }
  if (entry.sets.length === 0) return session;
  const next = activate(session, id, { sets: entry.sets.slice(0, -1) });
  return { ...next, lastSetCompletedAt: latestCompletedAt(next.entries) };
}

// 再加一组：目标组数 +1，动作回到进行中（做完这组再按"完成一组"）
export function addExtraSet(session, template, id) {
  const entry = findEntry(session, id);
  if (!entry || !findExercise(template, id) || entry.status !== 'done') return session;
  return activate(session, id, { extraSets: entry.extraSets + 1 });
}

// 列表顺序：未完成的按计划顺序，完成的下沉到底部（也按计划顺序）
export function orderedEntries(session) {
  const open = session.entries.filter((e) => e.status !== 'done');
  const done = session.entries.filter((e) => e.status === 'done');
  return [...open, ...done];
}

export function summarize(session, template) {
  let totalSets = 0;
  let doneExercises = 0;
  for (const e of session.entries) {
    const ex = findExercise(template, e.exerciseId);
    if (!ex) continue;
    totalSets += completedSets(e, ex);
    if (e.status === 'done') doneExercises += 1;
  }
  return { totalSets, doneExercises, totalExercises: session.entries.length };
}

// 结束训练：填 finishedAt，把运行态 status 映射成 spec 2.3 的 done / partial / skipped
export function finishSession(session, now) {
  return {
    ...session,
    finishedAt: now,
    activeExerciseId: null,
    entries: session.entries.map((e) => ({
      ...e,
      status: e.status === 'done' ? 'done' : e.sets.length > 0 ? 'partial' : 'skipped',
    })),
  };
}
