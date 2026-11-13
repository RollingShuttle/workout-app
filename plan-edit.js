// plan-edit.js — 修改训练计划的纯函数（spec 3.5）。都返回新对象，不改原计划；调用方负责 savePlan。
// 任何编辑都不碰已保存的训练记录（记录里存的是 exerciseId 和当时的数值）。
// 动作和训练日里的肌群组在 exercise-library.js 里改（动作库第 2 版）。

const WEEK_LABELS = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 0: '周日' };

// 安排的统一表示：{ type: 'day' | 'cardio' | 'ballOptional' | 'rest', id?, fallbackId?, ballOptional?, note? }
export function assignmentToEntry(assign, weekday) {
  const entry = { weekday, label: WEEK_LABELS[weekday] };
  if (assign.type === 'day') entry.primary = { type: 'day', id: assign.id };
  else if (assign.type === 'cardio') entry.primary = { type: 'cardio', id: assign.id };
  else if (assign.type === 'ballOptional') entry.primary = { type: 'ballOptional' };
  else entry.primary = { type: 'rest' };
  if (assign.fallbackId && (assign.type === 'ballOptional' || assign.type === 'day')) entry.fallback = { type: 'cardio', id: assign.fallbackId };
  if (assign.type === 'rest' && assign.ballOptional) entry.ballOptional = true;
  if (assign.note) entry.note = assign.note;
  return entry;
}

export function entryToAssignment(entry) {
  const p = (entry && (entry.primary || entry.plan)) || { type: 'rest' };
  return {
    type: p.type || 'rest',
    id: p.id || null,
    fallbackId: entry && entry.fallback ? entry.fallback.id : null,
    ballOptional: Boolean(entry && entry.ballOptional),
    note: (entry && entry.note) || '',
  };
}

export function setWeekday(plan, weekday, assign) {
  const entry = assignmentToEntry(assign, weekday);
  const rest = (plan.weeklySchedule || []).filter((w) => w.weekday !== weekday);
  const weeklySchedule = [...rest, entry].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  return { ...plan, weeklySchedule };
}

// 调课：按日期覆盖。assign 同上；date 'YYYY-MM-DD'
export function upsertOverride(plan, date, assign) {
  const entry = assignmentToEntry(assign, 0);
  const o = { date, plan: entry.primary };
  if (entry.fallback) o.fallback = entry.fallback;
  if (entry.ballOptional) o.ballOptional = true;
  if (entry.note) o.note = entry.note;
  if (assign.rotate) o.rotate = true; // 顺延 / 压缩挪过来的轮流训练日：仍按上一次做的决定正手 / 反手
  if (assign.batch) o.batch = assign.batch; // 同一次"不练"产生的一批调课，撤销时一起删
  if (assign.prev) o.prev = assign.prev; // 覆盖掉的原调课（如过渡周的），撤销时放回去
  const others = (plan.overrides || []).filter((x) => x.date !== date);
  return { ...plan, overrides: [...others, o].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
}

export function removeOverride(plan, date) {
  return { ...plan, overrides: (plan.overrides || []).filter((x) => x.date !== date) };
}

// 撤销调课：删掉这些记录，被它们覆盖掉的原调课（prev）放回去。pick(o) 决定哪些要撤
function restoreOverrides(plan, pick) {
  const keep = [];
  for (const o of plan.overrides || []) {
    if (!pick(o)) keep.push(o);
    else if (o.prev) keep.push(o.prev);
  }
  keep.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...plan, overrides: keep };
}

export function undoOverrideDate(plan, date) {
  return restoreOverrides(plan, (o) => o.date === date);
}

// 同一批（同一次"不练"产生）的全部调课一起撤
export function removeOverrideBatch(plan, batch) {
  return restoreOverrides(plan, (o) => o.batch === batch);
}

export function setTemplateEnabled(plan, templateId, enabled) {
  return { ...plan, dayTemplates: plan.dayTemplates.map((t) => (t.id === templateId ? { ...t, enabled } : t)) };
}

// 新动作的 id：英文 slug 不好自动起，用时间戳保证唯一；记录里只存 id，所以名字可以随便改
export function newExerciseId(now) {
  return `ex-${now.toString(36)}`;
}

// 把表单里的值变成 exercise 对象（重量：空 = 首次做时填）
export function exerciseFromForm(form, existing = {}) {
  const load = { unit: 'lb' };
  if (form.bodyweight) {
    load.bodyweight = true;
    load.label = form.label || '自重';
  } else {
    load.value = form.weight == null ? null : form.weight;
    if (form.assisted) load.assisted = true;
    if (form.perSideLoad) load.perSideLoad = true;
    if (form.label) load.label = form.label;
    if (form.step) load.step = form.step; // 档位：± 一次加减多少 lb（机器一格），进阶提示也按它
  }
  const ex = {
    ...existing,
    name: form.name,
    muscle: form.muscle || existing.muscle || '',
    load,
    sets: { min: form.setsMin, max: form.setsMax },
    reps: { min: form.repsMin, max: form.repsMax },
    restSeconds: form.restSeconds,
  };
  delete ex.alternates; // 第 2 版动作上没有替代关系（existing 是运行时对象，带着组里的其他动作）
  delete ex.slotMuscle;
  delete ex.actualId;
  if (form.perSide) ex.perSide = true;
  else delete ex.perSide;
  if (form.distance) ex.countUnit = 'm'; // 按距离计（弓步走）：reps 字段存米数
  else delete ex.countUnit;
  if (form.notes) ex.notes = form.notes;
  else delete ex.notes;
  return ex;
}
