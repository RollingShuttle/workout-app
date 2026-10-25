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
    entries: (template.exercises || []).map(newEntry),
  };
}

function newEntry(ex) {
  return {
    exerciseId: ex.id,
    usedAlternate: null, // 选用替代动作时记替代动作名（spec 2.3）
    sets: [],
    status: 'pending', // pending | active | done | skipped
    extraSets: 0, // "再加一组"累计
    endedEarly: false, // 做满 min 组后手动"结束动作"
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
  return base + (entry ? entry.extraSets || 0 : 0);
}

// 已完成组数。每侧动作也是一次"完成一组"算一组（用户决定：做完两侧再按，只要一个计时；
// 与 spec 3.2"左右各一次算一组"不同，见 PROGRESS.md 2026-10-24）
export function completedSets(entry, exercise) {
  return entry.sets.length;
}

export function isDone(entry, exercise) {
  return Boolean(entry.endedEarly) || completedSets(entry, exercise) >= targetSets(exercise, entry);
}

// 选了替代动作时，显示名和重量按替代动作来；没选就是原动作
export function effectiveExercise(entry, exercise) {
  if (!entry.usedAlternate) return exercise;
  const alt = (exercise.alternates || []).find((a) => a.name === entry.usedAlternate);
  if (!alt) return { ...exercise, name: entry.usedAlternate };
  // 替代动作没写 load = 重量未知（spec 2.2 的 null 语义），不沿用原动作的重量
  const load = alt.load || { value: null, unit: (exercise.load || {}).unit || 'lb' };
  return { ...exercise, name: alt.name, load };
}

function plannedWeight(entry, exercise) {
  const load = effectiveExercise(entry, exercise).load || {};
  return load.value ?? null;
}

// 结束动作：做满 min 组、还没到 max 时允许（spec 2.2）；超过计划组数的"再加一组"用"取消再加一组"退出
export function canEndExercise(entry, exercise) {
  const sets = exercise.sets || {};
  const min = sets.min ?? sets.max ?? 1;
  const max = sets.max ?? sets.min ?? 1;
  const done = completedSets(entry, exercise);
  return !isDone(entry, exercise) && entry.status !== 'skipped' && done >= min && done < max;
}

// 有没有用户输入：记了组，或者换了替代动作 / 跳过 / 提前结束。草稿保存和返回确认都看这个
export function sessionHasInput(session) {
  return Boolean(
    session &&
      session.entries.some((e) => e.sets.length > 0 || e.usedAlternate || e.status === 'skipped' || e.endedEarly)
  );
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
  if (!entry || !findExercise(template, id) || entry.status === 'done' || entry.status === 'skipped') return session;
  if (session.activeExerciseId === id) return session;
  return activate(session, id, {});
}

// 完成一组：记一条 set（重量、次数来自输入框；没传就用计划重量 / null）；达到目标组数 → 完成、清空进行中
export function completeSet(session, template, id, now, input = {}) {
  const entry = findEntry(session, id);
  const exercise = findExercise(template, id);
  if (!entry || !exercise || entry.status === 'done' || entry.status === 'skipped') return session;

  const setNo = entry.sets.length + 1;
  // 系统时钟被改到过去（now 早于上一组）时记 null，不要记成 0
  const restTakenSeconds =
    session.lastSetCompletedAt == null || now < session.lastSetCompletedAt
      ? null
      : Math.round((now - session.lastSetCompletedAt) / 1000);
  const weight = input.weight === undefined ? plannedWeight(entry, exercise) : input.weight;
  const reps = input.reps === undefined ? null : input.reps;
  const set = { setNo, weight, reps, completedAt: now, restTakenSeconds };
  if (entry.usedAlternate) set.usedAlternate = entry.usedAlternate; // 每组记下当时用的替代动作，中途切换也能分清

  const updated = { ...entry, sets: [...entry.sets, set] };
  const done = isDone(updated, exercise);
  const next = activate(session, id, updated);
  // 设置里关了「自动开始休息」时不起秒表（restStartedAt 留 null，按「开始计时」再起）
  const stamped = { ...next, lastSetCompletedAt: now, lastSetExerciseId: id, restStartedAt: input.autoStartRest === false ? null : now };
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
        e.exerciseId === id ? { ...e, extraSets: e.extraSets - 1, status: 'done', endedEarly: false } : e
      ),
    };
  }
  if (entry.sets.length === 0) return session;
  const next = activate(session, id, { sets: entry.sets.slice(0, -1), endedEarly: false });
  const latest = latestSet(next.entries);
  // 撤掉的正是秒表锚定的那组（剩下的最晚一组变了）→ 秒表退回到剩下的最后一组；
  // 撤的是更早的组 → 当前这次休息没变，restStartedAt 不动，手动"重置"不丢。
  const anchorRemoved = !latest || latest.at !== session.lastSetCompletedAt;
  return {
    ...next,
    lastSetCompletedAt: latest ? latest.at : null,
    lastSetExerciseId: latest ? latest.exerciseId : null,
    // 秒表本来没在走（自动休息关着）就保持不走
    restStartedAt: anchorRemoved ? (session.restStartedAt == null ? null : latest ? latest.at : null) : session.restStartedAt,
  };
}

// 旧版（v0.4）草稿只有 lastSetCompletedAt：补上秒表字段，重开后秒表才能接着算
// 计划在训练中途被改过时，让草稿的 entries 跟上模板：新动作补一条 pending，被删且一组都没记的去掉。
// 已有记录的被删动作保留（历史要完整），没有变化就返回原对象。
export function syncEntries(session, template) {
  const ids = new Set((template.exercises || []).map((ex) => ex.id));
  const kept = session.entries.filter((e) => ids.has(e.exerciseId) || e.sets.length > 0);
  const have = new Set(kept.map((e) => e.exerciseId));
  const added = (template.exercises || [])
    .filter((ex) => !have.has(ex.id))
    .map(newEntry);
  if (kept.length === session.entries.length && added.length === 0) return session;
  return { ...session, entries: [...kept, ...added] };
}

export function hydrateSession(session) {
  const latest = latestSet(session.entries);
  return {
    ...session,
    lastSetExerciseId: session.lastSetExerciseId ?? (latest ? latest.exerciseId : null),
    // 只给缺字段的旧草稿补；明确为 null（自动休息关着、还没按开始）的保持 null
    restStartedAt: session.restStartedAt !== undefined ? session.restStartedAt : session.lastSetCompletedAt ?? (latest ? latest.at : null),
  };
}

// 重置秒表：从现在重新计时。不改 lastSetCompletedAt，所以下一组的 restTakenSeconds 仍按真实的上一组算。
// 也用于「开始计时」（自动休息关着时手动起表）；还没做过任何一组时没意义，原样返回
export function resetRest(session, now) {
  if (session.lastSetCompletedAt == null && session.restStartedAt == null) return session;
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
  // 提前结束的动作："继续这个动作"只是回到进行中，目标组数不变
  if (entry.endedEarly) return activate(session, id, { endedEarly: false });
  return activate(session, id, { extraSets: entry.extraSets + 1 });
}

// 结束动作：做满 min 组后手动完成，变灰下沉
export function endExercise(session, template, id) {
  const entry = findEntry(session, id);
  const exercise = findExercise(template, id);
  if (!entry || !exercise || !canEndExercise(entry, exercise)) return session;
  return {
    ...session,
    activeExerciseId: session.activeExerciseId === id ? null : session.activeExerciseId,
    entries: session.entries.map((e) => (e.exerciseId === id ? { ...e, endedEarly: true, status: 'done' } : e)),
  };
}

// 跳过这个动作：已有的组保留，状态 skipped，下沉；取消跳过回到待做
export function skipExercise(session, template, id) {
  const entry = findEntry(session, id);
  if (!entry || !findExercise(template, id) || entry.status === 'done' || entry.status === 'skipped') return session;
  return {
    ...session,
    activeExerciseId: session.activeExerciseId === id ? null : session.activeExerciseId,
    entries: session.entries.map((e) => (e.exerciseId === id ? { ...e, status: 'skipped' } : e)),
  };
}

export function unskipExercise(session, template, id) {
  const entry = findEntry(session, id);
  if (!entry || !findExercise(template, id) || entry.status !== 'skipped') return session;
  return {
    ...session,
    entries: session.entries.map((e) => (e.exerciseId === id ? { ...e, status: 'pending' } : e)),
  };
}

// 换替代动作：name 为 null 表示换回原动作。只改这条记录的 usedAlternate，已记的组不动
export function setAlternate(session, template, id, name) {
  const entry = findEntry(session, id);
  const exercise = findExercise(template, id);
  if (!entry || !exercise) return session;
  if (name != null && !(exercise.alternates || []).some((a) => a.name === name)) return session;
  return {
    ...session,
    entries: session.entries.map((e) => (e.exerciseId === id ? { ...e, usedAlternate: name } : e)),
  };
}

// 列表顺序：未完成的按计划顺序，完成的下沉到底部（也按计划顺序）
export function orderedEntries(session) {
  const closed = (e) => e.status === 'done' || e.status === 'skipped';
  return [...session.entries.filter((e) => !closed(e)), ...session.entries.filter(closed)];
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
    pendingInput: null, // 输入框里还没提交的值，结束后不留
    entries: session.entries.map((e) => {
      const exercise = template ? findExercise(template, e.exerciseId) : null;
      let done;
      if (exercise) {
        const sets = exercise.sets || {};
        const planned = sets.max ?? sets.min ?? 1;
        done = Boolean(e.endedEarly) || completedSets(e, exercise) >= planned;
      } else {
        done = e.status === 'done';
      }
      // 再加的组只保留真正做了的部分，没做的不留痕迹
      const extraDone = exercise ? Math.max(0, completedSets(e, exercise) - (exercise.sets?.max ?? exercise.sets?.min ?? 1)) : e.extraSets;
      // 跳过且一组没做 → skipped；做了几组 → partial；做满或手动结束 → done
      const status = done ? 'done' : e.sets.length > 0 ? 'partial' : 'skipped';
      return { ...e, extraSets: extraDone, status };
    }),
  };
}

// 最后一组之后超过这么久才点"结束"（忘了结束 / 隔天补结束），结束时刻就按最后一组算，总时长才不会是一整天
export const STALE_FINISH_MS = 60 * 60 * 1000;

// 实际训练时长：从开始 → 每一组 → 结束，只累加不超过 STALE_FINISH_MS 的间隔。
// 跨天续练（昨天几组、今天几组）不会算成 24 小时。
export function activeDurationMs(session, finishedAt = session.finishedAt) {
  const times = [];
  for (const e of session.entries || []) for (const s of e.sets || []) if (typeof s.completedAt === 'number') times.push(s.completedAt);
  times.sort((a, b) => a - b);
  if (typeof finishedAt === 'number') times.push(finishedAt);
  let total = 0;
  let prev = session.startedAt;
  for (const t of times) {
    const d = t - prev;
    if (d > 0 && d <= STALE_FINISH_MS) total += d;
    if (t > prev) prev = t;
  }
  return total;
}

export function finishedAtFor(session, now) {
  const last = latestCompletedAt(session.entries) ?? session.startedAt;
  return now - last > STALE_FINISH_MS ? last : now;
}
