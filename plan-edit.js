// plan-edit.js — 修改训练计划的纯函数（spec 3.5）。都返回新对象，不改原计划；调用方负责 savePlan。
// 任何编辑都不碰已保存的训练记录（记录里存的是 exerciseId 和当时的数值）。

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
  const others = (plan.overrides || []).filter((x) => x.date !== date);
  return { ...plan, overrides: [...others, o].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
}

export function removeOverride(plan, date) {
  return { ...plan, overrides: (plan.overrides || []).filter((x) => x.date !== date) };
}

export function setTemplateEnabled(plan, templateId, enabled) {
  return { ...plan, dayTemplates: plan.dayTemplates.map((t) => (t.id === templateId ? { ...t, enabled } : t)) };
}

function mapTemplate(plan, templateId, fn) {
  return { ...plan, dayTemplates: plan.dayTemplates.map((t) => (t.id === templateId ? fn(t) : t)) };
}

// 整个替换（id 不变）：表单里取消勾选的字段（perSide / countUnit / notes）要真的消失，合并会把旧值留下来
export function updateExercise(plan, templateId, exerciseId, exercise) {
  return mapTemplate(plan, templateId, (t) => ({
    ...t,
    exercises: t.exercises.map((e) => (e.id === exerciseId ? { ...exercise, id: e.id } : e)),
  }));
}

export function moveExercise(plan, templateId, exerciseId, dir) {
  return mapTemplate(plan, templateId, (t) => {
    const list = [...t.exercises];
    const i = list.findIndex((e) => e.id === exerciseId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return t;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...t, exercises: list };
  });
}

export function addExercise(plan, templateId, exercise) {
  return mapTemplate(plan, templateId, (t) => ({ ...t, exercises: [...t.exercises, exercise] }));
}

export function removeExercise(plan, templateId, exerciseId) {
  return mapTemplate(plan, templateId, (t) => ({ ...t, exercises: t.exercises.filter((e) => e.id !== exerciseId) }));
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
  }
  const ex = {
    ...existing,
    name: form.name,
    muscle: form.muscle || existing.muscle || '',
    load,
    sets: { min: form.setsMin, max: form.setsMax },
    reps: { min: form.repsMin, max: form.repsMax },
    restSeconds: form.restSeconds,
    alternates: form.alternates || [],
  };
  if (form.perSide) ex.perSide = true;
  else delete ex.perSide;
  if (form.distance) ex.countUnit = 'm'; // 按距离计（弓步走）：reps 字段存米数
  else delete ex.countUnit;
  if (form.notes) ex.notes = form.notes;
  else delete ex.notes;
  return ex;
}

// "斜下胸推机器:45, 哑铃推" → [{name, load?}]
export function parseAlternates(text) {
  return (text || '')
    .split(/[,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)[:：]\s*(\d+(?:\.\d+)?)$/.exec(s);
      return m ? { name: m[1].trim(), load: { value: Number(m[2]), unit: 'lb' } } : { name: s };
    });
}

export function alternatesToText(list) {
  return (list || []).map((a) => (a.load && a.load.value != null ? `${a.name}:${a.load.value}` : a.name)).join('，');
}
