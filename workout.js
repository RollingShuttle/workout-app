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
    lastSetCompletedAt: null, // 上一组真正完成的时间，算 restTakenSeconds 用；重置秒表不动它
    lastSetExerciseId: null, // 上一组是哪个动作，秒表的参考休息时长按它取
    restStartedAt: null, // 组间秒表的起点：完成一组 = 那组的时间；按"重置" = 按下的时间
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

// 已完成组数。每侧动作也是一次"完成一组"算一组（用户决定：做完两侧再按，只要一个计时；
// 与 spec 3.2"左右各一次算一组"不同，见 PROGRESS.md 2026-10-24）
export function completedSets(entry, exercise) {
  return entry.sets.length;
}

export function isDone(entry, exercise) {
  return completedSets(entry, exercise) >= targetSets(exercise, entry);
}

function plannedWeight(exercise) {
  const load = exercise.load || {};
  return load.value ?? null;
}

// 所有记录里最晚完成的一组：{ at, exerciseId }；没有记录返回 null
function latestSet(entries) {
  let latest = null;
  for (const e of entries) {
    for (const s of e.sets) {
      if (!latest || s.completedAt > latest.at) latest = { at: s.completedAt, exerciseId: e.exerciseId };
    }
  }
  return latest;
}

function latestCompletedAt(entries) {
  const latest = latestSet(entries);
  return latest ? latest.at : null;
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

  const setNo = entry.sets.length + 1;
  // 系统时钟被改到过去（now 早于上一组）时记 null，不要记成 0
  const restTakenSeconds =
    session.lastSetCompletedAt == null || now < session.lastSetCompletedAt
      ? null
      : Math.round((now - session.lastSetCompletedAt) / 1000);
  const set = { setNo, weight: plannedWeight(exercise), reps: null, completedAt: now, restTakenSeconds };

  const updated = { ...entry, sets: [...entry.sets, set] };
  const done = isDone(updated, exercise);
  const next = activate(session, id, updated);
  const stamped = { ...next, lastSetCompletedAt: now, lastSetExerciseId: id, restStartedAt: now };
  if (done) {
    return {
      ...stamped,
      activeExerciseId: null,
      entries: stamped.entries.map((e) => (e.exerciseId === id ? { ...e, status: 'done' } : e)),
    };
  }
  return stamped;
}

// "再加一组"之后、那一组还没开始做：此时撤销 = 取消加组，回到完成态，不删真实记录
export function canCancelExtraSet(entry, exercise) {
  if (!entry || entry.extraSets <= 0) return false;
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
  const latest = latestSet(next.entries);
  // 撤掉的正是秒表锚定的那组（剩下的最晚一组变了）→ 秒表退回到剩下的最后一组；
  // 撤的是更早的组 → 当前这次休息没变，restStartedAt 不动，手动"重置"不丢。
  const anchorRemoved = !latest || latest.at !== session.lastSetCompletedAt;
  return {
    ...next,
    lastSetCompletedAt: latest ? latest.at : null,
    lastSetExerciseId: latest ? latest.exerciseId : null,
    restStartedAt: anchorRemoved ? (latest ? latest.at : null) : session.restStartedAt,
  };
}

// 旧版（v0.4）草稿只有 lastSetCompletedAt：补上秒表字段，重开后秒表才能接着算
export function hydrateSession(session) {
  const latest = latestSet(session.entries);
  return {
    ...session,
    lastSetExerciseId: session.lastSetExerciseId ?? (latest ? latest.exerciseId : null),
    restStartedAt: session.restStartedAt ?? session.lastSetCompletedAt ?? (latest ? latest.at : null),
  };
}

// 重置秒表：从现在重新计时。不改 lastSetCompletedAt，所以下一组的 restTakenSeconds 仍按真实的上一组算。
export function resetRest(session, now) {
  if (session.restStartedAt == null) return session;
  return { ...session, restStartedAt: now };
}

// 组间秒表的参考休息秒数：按上一组的动作取 restSeconds，没有就用默认值
export function restReferenceSeconds(session, template, fallback = 90) {
  const exercise = session.lastSetExerciseId ? findExercise(template, session.lastSetExerciseId) : null;
  return exercise && typeof exercise.restSeconds === 'number' ? exercise.restSeconds : fallback;
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

// 结束训练：填 finishedAt，把运行态 status 映射成 spec 2.3 的 done / partial / skipped。
// done 看的是"做够计划组数（sets.max）"，所以按过"再加一组"没做也算 done。template 为 null 时退回运行态判断。
export function finishSession(session, template, now) {
  return {
    ...session,
    finishedAt: now,
    activeExerciseId: null,
    restStartedAt: null,
    entries: session.entries.map((e) => {
      const exercise = template ? findExercise(template, e.exerciseId) : null;
      let done;
      if (exercise) {
        const sets = exercise.sets || {};
        const planned = sets.max ?? sets.min ?? 1;
        done = completedSets(e, exercise) >= planned;
      } else {
        done = e.status === 'done';
      }
      // 再加的组只保留真正做了的部分，没做的不留痕迹
      const extraDone = exercise ? Math.max(0, completedSets(e, exercise) - (exercise.sets?.max ?? exercise.sets?.min ?? 1)) : e.extraSets;
      return { ...e, extraSets: extraDone, status: done ? 'done' : e.sets.length > 0 ? 'partial' : 'skipped' };
    }),
  };
}

// 最后一组之后超过这么久才点"结束"（忘了结束 / 隔天补结束），结束时刻就按最后一组算，总时长才不会是一整天
export const STALE_FINISH_MS = 60 * 60 * 1000;

export function finishedAtFor(session, now) {
  const last = latestCompletedAt(session.entries) ?? session.startedAt;
  return now - last > STALE_FINISH_MS ? last : now;
}
