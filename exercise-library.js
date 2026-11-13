// exercise-library.js — 动作库（docs/exercise-library-plan.md）。纯函数，不碰数据库。
//
// 存储形状（库里的计划、备份文件、training-plan.json），第 2 版（2026-11-13 用户定：替代动作不挂在动作上，
// 训练日里按肌群放几个动作）：
//   plan.libraryVersion = 2
//   plan.exercises = [{ id, name, muscle, load, sets, reps, restSeconds, perSide?, countUnit?, notes? }]   每个动作单独设置
//   plan.dayTemplates[].exercises = [{ muscle, ids: [动作 id…], note? }]   一组 = 一个肌群，ids[0] 是默认动作，note = 当天备注
//   plan.mergedIds = { 旧 id: 新 id }                                      迁移时合并掉的动作，导入旧备份时照样换
// 第 1 版（v0.25 ～ v0.26）：动作上挂 alternates: [id]，训练日 [{ id, note? }]；toSlotPlan 换成第 2 版。
// 运行时形状（state.plan = expandPlan(...)）：dayTemplates[].exercises = 每组的默认动作（完整对象），它的 alternates =
//   同组的其他动作（完整对象），slotMuscle = 组名；另带 slots（存储形状）和 library（id → 完整动作），compactPlan 存库前去掉。
// 训练记录：entry.exerciseId = 这组的默认动作（当 key 用）；entry.alternateId = 换上来的动作（null = 默认动作）；
//   set.exerciseId = 这组实际做的动作，只在换了动作时写，没写就是 entry.exerciseId。

export const LIBRARY_VERSION = 2;

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

// 第 1 版或第 2 版的动作库计划（存储形状或运行时形状）
export function isLibraryPlan(plan) {
  return Boolean(plan && Array.isArray(plan.exercises) && plan.libraryVersion >= 1);
}

export function isSlotPlan(plan) {
  return isLibraryPlan(plan) && plan.libraryVersion >= 2;
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

function planFromContext(base, ctx, dayTemplates, version) {
  const exercises = [...ctx.byId.values()].map((e) => {
    if (version < 2) return { alternates: [], ...e };
    const { alternates: _ignored, ...rest } = e; // 第 2 版动作上没有替代关系
    return rest;
  });
  const plan = { ...base, libraryVersion: version, exercises, dayTemplates };
  if (Object.keys(ctx.mergedIds).length) plan.mergedIds = ctx.mergedIds;
  else delete plan.mergedIds;
  return plan;
}

// 第 1 版（动作上挂 alternates，训练日 [{ id, note? }]）→ 第 2 版（训练日按肌群放几个动作）。
// 每个动作原来的替代动作变成同一组里的其他选项；肌群名先用原动作的"肌群"；同一个训练日里已经出现过的动作不再放进别的组
export function toSlotPlan(plan) {
  if (!isLibraryPlan(plan) || plan.libraryVersion >= 2) return plan;
  const byId = new Map(plan.exercises.map((e) => [e.id, e]));
  const dayTemplates = (plan.dayTemplates || []).map((t) => {
    const slots = t.exercises || [];
    const used = new Set(slots.map((s) => s && s.id).filter(Boolean));
    return {
      ...t,
      exercises: slots
        .filter((s) => s && s.id)
        .map((s) => {
          const ex = byId.get(s.id);
          const ids = [s.id];
          for (const id of (ex && ex.alternates) || []) {
            if (byId.has(id) && !used.has(id)) {
              ids.push(id);
              used.add(id);
            }
          }
          const slot = { muscle: (ex && ex.muscle) || '', ids };
          if (s.note) slot.note = s.note;
          return slot;
        }),
    };
  });
  const exercises = plan.exercises.map(({ alternates: _ignored, ...e }) => e);
  return { ...plan, libraryVersion: 2, exercises, dayTemplates };
}

// 计划 + 记录一起迁移。plan 可以是旧版、第 1 版或第 2 版（第 2 版时只换记录，遇到不认识的替代动作名会往库里加动作）。
// 返回 { plan（存储形状，第 2 版）, sessions, planChanged, sessionsChanged: [改过的记录] }
export function migrateData({ plan, sessions = [] }) {
  let ctx;
  let nextTemplates;
  let version;
  let planChanged = false;
  if (isLibraryPlan(plan)) {
    ctx = libraryContext(compactPlan(plan));
    version = plan.libraryVersion;
  } else if (plan) {
    const built = buildFromOldPlan(plan);
    ctx = built.ctx;
    nextTemplates = built.dayTemplates;
    version = 1;
    planChanged = true;
  } else {
    ctx = libraryContext(null);
  }
  const out = sessions.map((s) => migrateSession(s, ctx));
  const sessionsChanged = out.filter((s, i) => s !== sessions[i]);
  if (ctx.wasAdded()) planChanged = true;
  let resultPlan = plan ? compactPlan(plan) : null;
  if (plan && planChanged) resultPlan = planFromContext(resultPlan, ctx, nextTemplates || resultPlan.dayTemplates, version);
  if (resultPlan && resultPlan.libraryVersion < LIBRARY_VERSION) {
    resultPlan = toSlotPlan(resultPlan);
    planChanged = true;
  }
  return { plan: resultPlan, sessions: out, planChanged, sessionsChanged };
}

// 只迁移计划（内置计划、空白计划）：旧版和第 1 版都换成第 2 版
export function ensureLibraryPlan(plan) {
  if (isSlotPlan(plan)) return plan;
  return migrateData({ plan }).plan;
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
  return { plan: { ...p, exercises: [...p.exercises, ...add.map(({ alternates: _ignored, ...e }) => clone(e))] }, changed: true };
}

/* ---------- 运行时展开 / 存库前收起 ---------- */

// 运行时每个训练日：exercises = 每组的默认动作（完整对象），它的 alternates = 同组的其他动作（完整对象），
// slotMuscle = 组名，notes = 当天备注优先；空组（还没放动作）不进 exercises。slots 保留存储形状给计划编辑用。
export function expandPlan(plan) {
  if (!isLibraryPlan(plan)) return plan;
  const compact = toSlotPlan(compactPlan(plan));
  const library = {};
  for (const ex of compact.exercises) library[ex.id] = clone(ex);
  const dayTemplates = (compact.dayTemplates || []).map((t) => {
    const slots = t.exercises || [];
    const exercises = [];
    for (const slot of slots) {
      const ids = ((slot && slot.ids) || []).filter((id) => library[id]);
      if (!ids.length) continue;
      const ex = clone(library[ids[0]]);
      ex.alternates = ids.slice(1).map((id) => clone(library[id]));
      ex.slotMuscle = slot.muscle || '';
      if (slot.note) ex.notes = slot.note; // 当天备注优先
      exercises.push(ex);
    }
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

// 运行时查动作（不管在不在训练日里）；找不到返回 null
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
  const exercises = [...next.exercises, ...old.exercises.filter((e) => !have.has(e.id)).map(({ alternates: _ignored, ...e }) => e)];
  const mergedIds = { ...(old.mergedIds || {}), ...(next.mergedIds || {}) };
  const out = { ...next, exercises };
  if (Object.keys(mergedIds).length) out.mergedIds = mergedIds;
  return out;
}

// 这个动作用在哪些训练日：[{ template, isDefault }]（运行时形状）
export function usageOf(plan, id) {
  const out = [];
  for (const t of plan.dayTemplates || []) {
    for (const slot of t.slots || []) {
      const i = ((slot && slot.ids) || []).indexOf(id);
      if (i >= 0) {
        out.push({ template: t, isDefault: i === 0 });
        break;
      }
    }
  }
  return out;
}

export function usageText(plan, id) {
  const u = usageOf(plan, id);
  return u.length ? u.map((x) => (x.isDefault ? x.template.name : `${x.template.name}（可换）`)).join('、') : '没排进训练日';
}

/* ---------- 动作库编辑（"动作"页：每个动作单独设置，所有训练日一起变） ---------- */

function mapTemplate(plan, templateId, fn) {
  return { ...plan, dayTemplates: plan.dayTemplates.map((t) => (t.id === templateId ? fn(t) : t)) };
}

// 把表单的值写进动作库。form 是 plan-edit.js exerciseFromForm 的结果（不带 id）
function writeExercise(plan, id, form) {
  const { alternates: _alts, id: _ignored, notes, ...def } = form;
  const next = { ...def, id };
  if (notes) next.notes = notes;
  const exists = plan.exercises.some((e) => e.id === id);
  const exercises = exists ? plan.exercises.map((e) => (e.id === id ? next : e)) : [...plan.exercises, next];
  return { ...plan, exercises };
}

export function updateLibraryExercise(plan, _templateId, exerciseId, form) {
  return expandPlan(writeExercise(compactPlan(plan), exerciseId, form));
}

// 新增动作：动作库里已经有同名的就不新建，返回那一条的 id（表单值不覆盖它）
export function createLibraryExercise(plan, newId, form) {
  const p = compactPlan(plan);
  const same = p.exercises.find((e) => nameKey(e.name) === nameKey(form.name));
  if (same) return { plan: expandPlan(p), id: same.id, existed: true };
  return { plan: expandPlan(writeExercise(p, newId, form)), id: newId, existed: false };
}

/* ---------- 训练日编辑：每组 = 肌群名 + 几个动作（第一个是默认），按组的序号改 ---------- */

function mapSlots(plan, templateId, fn) {
  const p = compactPlan(plan);
  return expandPlan(mapTemplate(p, templateId, (t) => ({ ...t, exercises: fn([...(t.exercises || [])]) })));
}

function move(list, i, dir) {
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// 这个训练日里已经用了的动作（同一个动作在一天里只能出现一次：训练记录按它当 key）
export function idsInTemplate(plan, templateId) {
  const t = (plan.dayTemplates || []).find((x) => x.id === templateId);
  return new Set(((t && (t.slots || t.exercises)) || []).flatMap((s) => (s && s.ids) || []));
}

export function addSlot(plan, templateId, muscle, note = '') {
  return mapSlots(plan, templateId, (slots) => [...slots, note ? { muscle, ids: [], note } : { muscle, ids: [] }]);
}

export function editSlot(plan, templateId, index, { muscle, note }) {
  return mapSlots(plan, templateId, (slots) =>
    slots.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s, muscle };
      if (note) next.note = note;
      else delete next.note;
      return next;
    })
  );
}

export function moveSlotGroup(plan, templateId, index, dir) {
  return mapSlots(plan, templateId, (slots) => move(slots, index, dir));
}

export function removeSlotGroup(plan, templateId, index) {
  return mapSlots(plan, templateId, (slots) => slots.filter((_, i) => i !== index));
}

export function addToSlot(plan, templateId, index, exerciseId) {
  if (idsInTemplate(plan, templateId).has(exerciseId)) return plan;
  return mapSlots(plan, templateId, (slots) => slots.map((s, i) => (i === index ? { ...s, ids: [...(s.ids || []), exerciseId] } : s)));
}

// 组里调顺序；挪到第一个 = 设为默认
export function moveInSlot(plan, templateId, index, exerciseId, dir) {
  return mapSlots(plan, templateId, (slots) =>
    slots.map((s, i) => (i === index ? { ...s, ids: move(s.ids || [], (s.ids || []).indexOf(exerciseId), dir) } : s))
  );
}

// 从组里拿掉；动作库里的那一条留着，历史记录里的名字还认得
export function removeFromSlot(plan, templateId, index, exerciseId) {
  return mapSlots(plan, templateId, (slots) => slots.map((s, i) => (i === index ? { ...s, ids: (s.ids || []).filter((id) => id !== exerciseId) } : s)));
}
