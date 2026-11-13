// exercise-library.js — 动作库（docs/exercise-library-plan.md）。纯函数，不碰数据库。
//
// 存储形状（库里的计划、备份文件、training-plan.json）：
//   plan.libraryVersion = 1
//   plan.exercises = [{ id, name, muscle, load, sets, reps, restSeconds, perSide?, countUnit?, notes?, alternates: [动作 id] }]
//   plan.dayTemplates[].exercises = [{ id, note? }]   训练日只排顺序，note = 当天备注
//   plan.mergedIds = { 旧 id: 新 id }                  迁移时合并掉的动作，导入旧备份时照样换
// 运行时形状（state.plan = expandPlan(...)）：dayTemplates[].exercises 是完整动作对象（库里的定义 + 当天备注），
//   每个动作的 alternates 展开成完整动作对象；另带 slots（存储形状）和 library（id → 完整动作），compactPlan 存库前去掉。
// 训练记录：entry.exerciseId = 计划里的那个动作；entry.alternateId = 正在用的替代动作（null = 原动作）；
//   set.exerciseId = 这组实际做的动作，只在用替代动作时写，没写就是 entry.exerciseId。

export const LIBRARY_VERSION = 1;

// 名字不同、其实是同一个动作（用户 2026-11-12 确认合并）。每组第一个是准名
const SAME_EXERCISE = [
  ['斜上哑铃卧推', '上斜哑铃卧推'],
  ['上斜器械推胸', '斜上器械推胸'],
  ['侧平举', '哑铃侧平举'],
  ['肱二弯举', '哑铃弯举'],
];
const ALIAS = new Map(SAME_EXERCISE.flatMap((group) => group.map((n) => [n, group[0]])));

export function nameKey(name) {
  const n = String(name || '').trim();
  return ALIAS.get(n) || n;
}

// 由名字算 id：同名永远同 id，旧备份导入也对得上（FNV-1a 32 位）
export function idForName(name) {
  let h = 0x811c9dc5;
  for (const ch of nameKey(name)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `x-${h.toString(36)}`; // 和计划编辑新建的 ex-时间戳 分开
}

export function isLibraryPlan(plan) {
  return Boolean(plan && Array.isArray(plan.exercises) && plan.libraryVersion >= LIBRARY_VERSION);
}

// 当前实际在做的动作 / 某一组实际做的动作
export function currentExerciseId(entry) {
  return entry.alternateId || entry.exerciseId;
}

export function setExerciseId(set, entry) {
  return (set && set.exerciseId) || entry.exerciseId;
}

// 旧版记录：entry / set 上有 usedAlternate（替代动作名）
export function isOldSession(session) {
  return Boolean(
    session &&
      Array.isArray(session.entries) &&
      session.entries.some((e) => e && ('usedAlternate' in e || (e.sets || []).some((s) => s && 'usedAlternate' in s)))
  );
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

// 替代动作的新动作：组数 / 次数 / 休息 / 每侧 / 按米先抄原动作（旧版替代动作就是这样沿用的），重量用替代动作写的
function exerciseFromAlternate(name, base, load) {
  const ex = {
    id: idForName(name),
    name: String(name).trim(),
    muscle: (base && base.muscle) || '',
    load: load ? clone(load) : { value: null, unit: (base && base.load && base.load.unit) || 'lb' },
    sets: base && base.sets ? clone(base.sets) : { min: 3, max: 3 },
    reps: base && base.reps ? clone(base.reps) : { min: 8, max: 12 },
    restSeconds: base && typeof base.restSeconds === 'number' ? base.restSeconds : 90,
    alternates: [],
  };
  if (base && base.perSide) ex.perSide = true;
  if (base && base.countUnit) ex.countUnit = base.countUnit;
  return ex;
}

// 迁移 / 导入时用的动作库上下文：按 id、按名字查，找不到的替代动作名就新建
function libraryContext(plan) {
  const byId = new Map();
  const byKey = new Map();
  const mergedIds = { ...((plan && plan.mergedIds) || {}) };
  const add = (ex) => {
    byId.set(ex.id, ex);
    const key = nameKey(ex.name);
    if (!byKey.has(key)) byKey.set(key, ex.id);
  };
  if (isLibraryPlan(plan)) for (const ex of plan.exercises) add(clone(ex));
  const mapId = (id) => mergedIds[id] || id;
  let added = false;
  const resolveAlt = (baseId, name) => {
    const key = nameKey(name);
    if (!key) return null;
    if (byKey.has(key)) return byKey.get(key);
    const ex = exerciseFromAlternate(name, byId.get(mapId(baseId)), null);
    add(ex);
    added = true;
    return ex.id;
  };
  return { byId, byKey, mergedIds, add, mapId, resolveAlt, wasAdded: () => added };
}

// 旧计划（动作抄在每个训练日里、替代动作只有名字）→ 动作库
function buildFromOldPlan(old) {
  const ctx = libraryContext(null);
  const templates = old.dayTemplates || [];
  const occurrences = new Map(); // 动作 id → [{ t, i, notes }]
  const slotIds = templates.map(() => []);
  // 第一遍：主动作。同 id 合成一条；不同 id 但同名（或在 SAME_EXERCISE 里）、且不在同一个训练日里的也合成一条
  templates.forEach((t, ti) => {
    const inThisDay = new Set();
    (t.exercises || []).forEach((e, i) => {
      if (!e || !e.id) return;
      let id = e.id;
      if (!ctx.byId.has(id)) {
        const same = ctx.byKey.get(nameKey(e.name));
        if (same && !inThisDay.has(same)) {
          ctx.mergedIds[id] = same;
          id = same;
        } else {
          const { alternates, notes, ...def } = clone(e);
          ctx.add({ ...def, alternates: [] });
        }
      }
      inThisDay.add(id);
      slotIds[ti][i] = id;
      if (!occurrences.has(id)) occurrences.set(id, []);
      occurrences.get(id).push({ ti, i, notes: (e.notes || '').trim() });
    });
  });
  // 第二遍：替代动作 → 动作 id（同名并到已有动作，否则新建）
  templates.forEach((t, ti) => {
    (t.exercises || []).forEach((e, i) => {
      const id = slotIds[ti][i];
      if (!id) return;
      const base = ctx.byId.get(id);
      for (const a of e.alternates || []) {
        if (!a || !a.name) continue;
        const key = nameKey(a.name);
        let altId = ctx.byKey.get(key);
        if (!altId) {
          const ex = exerciseFromAlternate(a.name, base, a.load);
          ctx.add(ex);
          altId = ex.id;
        } else {
          // 同一个动作先出现的那处没写重量、这处写了：用这处的
          const existing = ctx.byId.get(altId);
          const cur = existing.load || {};
          if (a.load && a.load.value != null && cur.value == null && !cur.bodyweight) existing.load = { ...cur, ...clone(a.load) };
        }
        if (altId !== id && !base.alternates.includes(altId)) base.alternates.push(altId);
      }
    });
  });
  // 备注：各处一样 → 放在动作上；不一样 → 各训练日的当天备注
  const slotNotes = templates.map(() => []);
  for (const [id, occ] of occurrences) {
    const ex = ctx.byId.get(id);
    const distinct = new Set(occ.map((o) => o.notes));
    if (distinct.size === 1) {
      const only = occ[0].notes;
      if (only) ex.notes = only;
    } else {
      for (const o of occ) if (o.notes) slotNotes[o.ti][o.i] = o.notes;
    }
  }
  const dayTemplates = templates.map((t, ti) => {
    const seen = new Set();
    const slots = [];
    (t.exercises || []).forEach((e, i) => {
      const id = slotIds[ti][i];
      if (!id || seen.has(id)) return;
      seen.add(id);
      slots.push(slotNotes[ti][i] ? { id, note: slotNotes[ti][i] } : { id });
    });
    return { ...t, exercises: slots };
  });
  return { ctx, dayTemplates };
}

function planFromContext(base, ctx, dayTemplates) {
  const plan = { ...base, libraryVersion: LIBRARY_VERSION, exercises: [...ctx.byId.values()], dayTemplates };
  if (Object.keys(ctx.mergedIds).length) plan.mergedIds = ctx.mergedIds;
  else delete plan.mergedIds;
  return plan;
}

// 一条旧版记录 → 新版：usedAlternate（名字）换成动作 id，合并掉的 id 换成新 id。新版记录原样返回
function migrateSession(s, ctx) {
  if (!s || !Array.isArray(s.entries)) return s;
  const old = isOldSession(s);
  const mapsIds = s.entries.some((e) => e && ctx.mapId(e.exerciseId) !== e.exerciseId);
  if (!old && !mapsIds) return s;
  const entries = s.entries.map((e) => {
    if (!e) return e;
    const orig = e.exerciseId;
    const id = ctx.mapId(orig);
    const { usedAlternate, ...rest } = e;
    let alternateId = rest.alternateId ? ctx.mapId(rest.alternateId) : null;
    if (usedAlternate) alternateId = ctx.resolveAlt(orig, usedAlternate);
    if (alternateId === id) alternateId = null;
    const sets = (e.sets || []).map((set) => {
      if (!set || !('usedAlternate' in set)) return set;
      const { usedAlternate: name, ...r } = set;
      const sid = name ? ctx.resolveAlt(orig, name) : null;
      return sid && sid !== id ? { ...r, exerciseId: sid } : r;
    });
    return { ...rest, exerciseId: id, alternateId, sets };
  });
  const next = { ...s, entries };
  if (s.activeExerciseId) next.activeExerciseId = ctx.mapId(s.activeExerciseId);
  if (s.lastSetExerciseId) next.lastSetExerciseId = ctx.mapId(s.lastSetExerciseId);
  if (s.pendingInput && typeof s.pendingInput === 'object') {
    const { usedAlternate, ...p } = s.pendingInput;
    const orig = p.exerciseId;
    const alt = usedAlternate ? ctx.resolveAlt(orig, usedAlternate) : p.alternateId || null;
    next.pendingInput = { ...p, exerciseId: ctx.mapId(orig), alternateId: alt };
  }
  return next;
}

// 计划 + 记录一起迁移。plan 可以是旧版或新版（新版时只换记录，遇到不认识的替代动作名会往库里加动作）。
// 返回 { plan（存储形状）, sessions, planChanged, sessionsChanged: [改过的记录] }
export function migrateData({ plan, sessions = [] }) {
  let ctx;
  let nextPlan;
  let planChanged = false;
  if (isLibraryPlan(plan)) {
    ctx = libraryContext(compactPlan(plan));
  } else if (plan) {
    const built = buildFromOldPlan(plan);
    ctx = built.ctx;
    nextPlan = built.dayTemplates;
    planChanged = true;
  } else {
    ctx = libraryContext(null);
  }
  const out = sessions.map((s) => migrateSession(s, ctx));
  const sessionsChanged = out.filter((s, i) => s !== sessions[i]);
  if (ctx.wasAdded()) planChanged = true;
  let resultPlan = plan ? compactPlan(plan) : null;
  if (plan && planChanged) resultPlan = planFromContext(resultPlan, ctx, nextPlan || resultPlan.dayTemplates);
  return { plan: resultPlan, sessions: out, planChanged, sessionsChanged };
}

// 只迁移计划（内置计划、空白计划）
export function ensureLibraryPlan(plan) {
  return isLibraryPlan(plan) ? plan : migrateData({ plan }).plan;
}

// 合并导入：导入的记录用到、现在的动作库里却没有的动作，从文件里的计划抄过来（不然历史里只剩 id）。
// filePlan 可以是旧版计划。返回 { plan（存储形状）, changed }
export function adoptReferencedExercises(plan, filePlan, sessions) {
  const p = compactPlan(plan);
  if (!isLibraryPlan(p) || !filePlan) return { plan: p, changed: false };
  const file = ensureLibraryPlan(compactPlan(filePlan));
  if (!isLibraryPlan(file)) return { plan: p, changed: false };
  const mapId = (id) => (p.mergedIds && p.mergedIds[id]) || id;
  const used = new Set();
  for (const s of sessions) {
    for (const e of (s && s.entries) || []) {
      if (!e) continue;
      used.add(mapId(e.exerciseId));
      if (e.alternateId) used.add(mapId(e.alternateId));
      for (const set of e.sets || []) if (set && set.exerciseId) used.add(mapId(set.exerciseId));
    }
  }
  const have = new Set(p.exercises.map((e) => e.id));
  const add = file.exercises.filter((e) => used.has(e.id) && !have.has(e.id));
  if (!add.length) return { plan: p, changed: false };
  return { plan: { ...p, exercises: [...p.exercises, ...add.map((e) => clone(e))] }, changed: true };
}

/* ---------- 运行时展开 / 存库前收起 ---------- */

function fullExercise(ex, raw) {
  const alternates = (ex.alternates || [])
    .map((id) => raw[id])
    .filter(Boolean)
    .map(({ alternates: _ignored, ...a }) => clone(a));
  return { ...clone(ex), alternates };
}

export function expandPlan(plan) {
  if (!isLibraryPlan(plan)) return plan;
  const compact = compactPlan(plan);
  const raw = {};
  for (const ex of compact.exercises) raw[ex.id] = ex;
  const library = {};
  for (const ex of compact.exercises) library[ex.id] = fullExercise(ex, raw);
  const dayTemplates = (compact.dayTemplates || []).map((t) => {
    const slots = t.exercises || [];
    const exercises = slots
      .filter((slot) => slot && raw[slot.id])
      .map((slot) => {
        const ex = fullExercise(raw[slot.id], raw);
        if (slot.note) ex.notes = slot.note; // 当天备注优先
        return ex;
      });
    return { ...t, slots, exercises, library };
  });
  return { ...compact, dayTemplates, library };
}

export function compactPlan(plan) {
  if (!isLibraryPlan(plan)) return plan;
  const { library, ...rest } = plan;
  return {
    ...rest,
    dayTemplates: (plan.dayTemplates || []).map((t) => {
      const { slots, library: _lib, exercises, ...r } = t;
      return { ...r, exercises: slots || exercises || [] };
    }),
  };
}

// 运行时查动作（含不在任何训练日里的替代动作）；找不到返回 null
export function exerciseById(plan, id) {
  if (!plan || !id) return null;
  if (plan.library && plan.library[id]) return plan.library[id];
  for (const t of plan.dayTemplates || []) {
    const ex = (t.exercises || []).find((e) => e && e.id === id);
    if (ex) return ex;
  }
  return null;
}

// "重新载入内置计划"：用内置计划，但保留旧库里内置计划没有的动作（历史记录里的名字还认得）和合并表
export function withKeptLibrary(builtin, oldPlan) {
  const next = compactPlan(builtin);
  const old = compactPlan(oldPlan);
  if (!isLibraryPlan(next) || !isLibraryPlan(old)) return next;
  const have = new Set(next.exercises.map((e) => e.id));
  const exercises = [...next.exercises, ...old.exercises.filter((e) => !have.has(e.id))];
  const mergedIds = { ...(old.mergedIds || {}), ...(next.mergedIds || {}) };
  const out = { ...next, exercises };
  if (Object.keys(mergedIds).length) out.mergedIds = mergedIds;
  return out;
}

/* ---------- 计划编辑（训练日里改动作 = 改动作库里那一条，所有训练日一起变） ---------- */

function mapTemplate(plan, templateId, fn) {
  return { ...plan, dayTemplates: plan.dayTemplates.map((t) => (t.id === templateId ? fn(t) : t)) };
}

// 表单里的替代动作 [{ name, load? }] → 动作 id；同名的用已有动作（写了重量就更新它的重量），没有的按原动作新建
function resolveAlternateSpecs(exercises, specs, base) {
  const list = [...exercises];
  const ids = [];
  for (const spec of specs || []) {
    if (!spec || !spec.name) continue;
    const key = nameKey(spec.name);
    let idx = list.findIndex((e) => nameKey(e.name) === key);
    if (idx < 0) {
      list.push(exerciseFromAlternate(spec.name, base, spec.load));
      idx = list.length - 1;
    } else if (spec.load && spec.load.value != null && (list[idx].load || {}).value !== spec.load.value) {
      list[idx] = { ...list[idx], load: { ...(list[idx].load || { unit: 'lb' }), value: spec.load.value } };
    }
    const id = list[idx].id;
    if (id !== base.id && !ids.includes(id)) ids.push(id);
  }
  return { exercises: list, ids };
}

// 把表单的值写进动作库。form 是 plan-edit.js exerciseFromForm 的结果（alternates 是 [{ name, load? }]，notes 是备注）
function writeExercise(plan, templateId, id, form) {
  const { alternates: specs, notes, id: _ignored, ...def } = form;
  const exists = plan.exercises.some((e) => e.id === id);
  let exercises = exists ? plan.exercises : [...plan.exercises, { id, ...def, alternates: [] }];
  const base = { id, ...def };
  const resolved = resolveAlternateSpecs(exercises, specs, base);
  exercises = resolved.exercises;
  const t = plan.dayTemplates.find((x) => x.id === templateId);
  const slot = t ? (t.exercises || []).find((s) => s.id === id) : null;
  const dayNote = Boolean(slot && slot.note); // 这个训练日有当天备注：备注框改的是当天备注
  exercises = exercises.map((e) => {
    if (e.id !== id) return e;
    const next = { ...def, id, alternates: resolved.ids };
    if (!dayNote && notes) next.notes = notes;
    if (dayNote && e.notes) next.notes = e.notes;
    return next;
  });
  let next = { ...plan, exercises };
  if (dayNote) {
    next = mapTemplate(next, templateId, (tt) => ({
      ...tt,
      exercises: tt.exercises.map((s) => (s.id === id ? (notes ? { id, note: notes } : { id }) : s)),
    }));
  }
  return next;
}

export function updateLibraryExercise(plan, templateId, exerciseId, form) {
  return expandPlan(writeExercise(compactPlan(plan), templateId, exerciseId, form));
}

// 新加动作：动作库里已经有同名的就直接用那一条（不同天练同一个动作，记录和设置共用），
// 表单里的值不覆盖它——新增表单是空白默认值，覆盖会把别的训练日的组数次数改掉；要改就加完再点"修改"
export function addLibraryExercise(plan, templateId, newId, form) {
  const p = compactPlan(plan);
  const same = p.exercises.find((e) => nameKey(e.name) === nameKey(form.name));
  const id = same ? same.id : newId;
  let next = same ? p : writeExercise(p, templateId, id, form);
  next = mapTemplate(next, templateId, (t) =>
    (t.exercises || []).some((s) => s.id === id) ? t : { ...t, exercises: [...(t.exercises || []), { id }] }
  );
  return expandPlan(next);
}

// 从训练日里拿掉；动作库里的那一条留着，历史记录里的名字还认得
export function removeSlot(plan, templateId, exerciseId) {
  const p = compactPlan(plan);
  return expandPlan(mapTemplate(p, templateId, (t) => ({ ...t, exercises: (t.exercises || []).filter((s) => s.id !== exerciseId) })));
}

export function moveSlot(plan, templateId, exerciseId, dir) {
  const p = compactPlan(plan);
  return expandPlan(
    mapTemplate(p, templateId, (t) => {
      const list = [...(t.exercises || [])];
      const i = list.findIndex((s) => s.id === exerciseId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return t;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...t, exercises: list };
    })
  );
}
