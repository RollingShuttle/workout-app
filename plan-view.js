// plan-view.js — 计划编辑页（spec 3.5）：总览（每周安排 / 调课 / 训练日）、训练日动作列表、编辑表单。只画 DOM。
import { el, replaceChildren } from './dom.js';
import { formatLoad, formatSetsReps, parseDateKey, WEEKDAY_LABELS } from './schedule.js';
import { entryToAssignment, alternatesToText } from './plan-edit.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function fmtDate(key) {
  const d = parseDateKey(key);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEKDAY_LABELS[d.getDay()]}` : key || '';
}

function header(title, sub, onBack) {
  return el('header', { class: 'train-header' }, [
    el('div', { class: 'train-topline' }, [
      el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
      el('div', { class: 'train-title' }, [
        el('h1', { class: 'train-name', text: title }),
        sub ? el('div', { class: 'train-sub', text: sub }) : null,
      ]),
    ]),
  ]);
}

function section(title, children) {
  return el('section', { class: 'plan-section' }, [el('h2', { class: 'plan-section-title', text: title }), ...[].concat(children)]);
}

function list(rows, emptyText) {
  return rows.length ? el('ul', { class: 'hist-list', role: 'list' }, rows) : el('p', { class: 'muted', text: emptyText });
}

function actionBtn(label, onclick, cls = 'btn-secondary link-btn') {
  return el('button', { class: cls, type: 'button', onclick }, label);
}

// 一条安排的说明文字
export function describeAssignment(assign, plan) {
  const day = (plan.dayTemplates || []).find((t) => t.id === assign.id);
  const cardio = (plan.cardioTemplates || []).find((c) => c.id === assign.id);
  const fb = (plan.cardioTemplates || []).find((c) => c.id === assign.fallbackId);
  switch (assign.type) {
    case 'day':
      return `${day ? day.name : assign.id || '?'}${day && day.enabled === false ? `（未启用${fb ? `，做 ${fb.name}` : ''}）` : ''}`;
    case 'cardio':
      return cardio ? cardio.name : assign.id || '?';
    case 'ballOptional':
      return `可选打球${fb ? ` · 不打做 ${fb.name}` : ''}`;
    default:
      return `休息${assign.ballOptional ? '（可打球）' : ''}`;
  }
}

export function renderPlanOverview(root, { plan, saveError, onEditWeekday, onAddOverride, onEditOverride, onOpenDay, onToggleTemplate, onBack }) {
  const weekRows = WEEK_ORDER.map((wd) => {
    const entry = (plan.weeklySchedule || []).find((w) => w.weekday === wd);
    const a = entryToAssignment(entry);
    return el('li', { class: 'hist-row' }, [
      el('button', { class: 'hist-row-btn', type: 'button', onclick: () => onEditWeekday(wd, a) }, [
        el('span', { class: 'hist-date', text: WEEKDAY_LABELS[wd] }),
        el('span', { class: 'hist-type', text: describeAssignment(a, plan) }),
        a.note ? el('span', { class: 'hist-meta', text: a.note }) : null,
      ]),
    ]);
  });
  const overrideRows = (plan.overrides || []).map((o) => {
    const a = entryToAssignment(o);
    return el('li', { class: 'hist-row' }, [
      el('button', { class: 'hist-row-btn', type: 'button', onclick: () => onEditOverride(o.date, a) }, [
        el('span', { class: 'hist-date', text: fmtDate(o.date) }),
        el('span', { class: 'hist-type', text: describeAssignment(a, plan) }),
        a.note ? el('span', { class: 'hist-meta', text: a.note }) : null,
      ]),
    ]);
  });
  const dayRows = (plan.dayTemplates || []).map((t) =>
    el('li', { class: 'hist-row plan-day-row' }, [
      el('button', { class: 'hist-row-btn', type: 'button', onclick: () => onOpenDay(t.id) }, [
        el('span', { class: 'hist-date', text: t.name }),
        el('span', { class: 'hist-type', text: `${(t.exercises || []).length} 个动作` }),
      ]),
      el('label', { class: 'plan-toggle' }, [
        el('input', { type: 'checkbox', checked: t.enabled !== false, onchange: (e) => onToggleTemplate(t.id, e.target.checked) }),
        el('span', { text: '启用' }),
      ]),
    ])
  );
  replaceChildren(root, [
    header('计划', '改完立刻生效，不影响已保存的记录', onBack),
    saveError ? el('p', { class: 'problem save-error', text: saveError }) : null,
    section('每周安排', list(weekRows, '')),
    section('调课（按日期覆盖当天安排）', [list(overrideRows, '没有调课'), actionBtn('新增调课', onAddOverride)]),
    section('训练日', list(dayRows, '还没有训练日')),
  ]);
}

/* ---------- 表单零件 ---------- */

function textField(id, label, value, attrs = {}) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: id, text: label }),
    el('input', { class: 'sheet-text', id, type: 'text', value: value == null ? '' : String(value), ...attrs }),
  ]);
}

function numField(id, label, value, attrs = {}) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: id, text: label }),
    el('input', { class: 'num sheet-input', id, type: 'number', inputmode: 'decimal', value: value == null ? '' : String(value), ...attrs }),
  ]);
}

function selectField(id, label, options, value) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: id, text: label }),
    el('select', { class: 'sheet-select', id }, options.map((o) => el('option', { value: o.value, selected: o.value === value }, o.label))),
  ]);
}

function checkField(id, label, checked) {
  return el('label', { class: 'plan-check', for: id }, [el('input', { type: 'checkbox', id, checked: Boolean(checked) }), el('span', { text: label })]);
}

function sheetShell(root, title, body, { onClose }) {
  const errEl = el('p', { class: 'set-error', 'aria-live': 'polite' });
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  document.addEventListener('keydown', onKey);
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, [
    el('div', { class: 'sheet-title', text: title }),
    ...body,
    errEl,
  ]);
  root.appendChild(el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet]));
  sheet.focus();
  return { sheet, errEl, close, done: () => document.removeEventListener('keydown', onKey) };
}

const TYPE_OPTIONS = [
  { value: 'day', label: '固定训练日' },
  { value: 'ballOptional', label: '可选打球' },
  { value: 'cardio', label: '有氧' },
  { value: 'rest', label: '休息' },
];

// 每周安排 / 调课共用的编辑表单。withDate=true 时多一个日期框（调课）。
export function renderAssignmentSheet(root, { title, plan, assign, date, withDate, allowDelete, onSave, onDelete, onClose }) {
  const dayOptions = (plan.dayTemplates || []).map((t) => ({ value: t.id, label: t.name + (t.enabled === false ? '（未启用）' : '') }));
  const cardioOptions = (plan.cardioTemplates || []).filter((c) => c.id !== 'ball').map((c) => ({ value: c.id, label: c.name }));
  const fbOptions = [{ value: '', label: '不设' }, ...cardioOptions];
  const dayRow = selectField('as-day', '训练日', dayOptions.length ? dayOptions : [{ value: '', label: '（没有训练日）' }], assign.id);
  const cardioRow = selectField('as-cardio', '有氧模板', cardioOptions, assign.id);
  const fbRow = selectField('as-fb', '不打球 / 未启用时做什么', fbOptions, assign.fallbackId || '');
  const restRow = el('div', { class: 'field' }, [checkField('as-ball', '休息日也可以打球', assign.ballOptional)]);
  const typeRow = selectField('as-type', '类型', TYPE_OPTIONS, assign.type);
  const body = [
    withDate ? el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'as-date', text: '日期' }), el('input', { class: 'sheet-text', id: 'as-date', type: 'date', value: date || '' })]) : null,
    typeRow,
    dayRow,
    cardioRow,
    fbRow,
    restRow,
    textField('as-note', '备注（可选）', assign.note, { maxlength: '60' }),
  ];
  const shell = sheetShell(root, title, body, { onClose });
  const typeSel = shell.sheet.querySelector('#as-type');
  const refresh = () => {
    const t = typeSel.value;
    dayRow.hidden = t !== 'day';
    cardioRow.hidden = t !== 'cardio';
    fbRow.hidden = !(t === 'day' || t === 'ballOptional');
    restRow.hidden = t !== 'rest';
  };
  typeSel.addEventListener('change', refresh);
  refresh();
  const save = () => {
    const t = typeSel.value;
    const out = { type: t, id: null, fallbackId: null, ballOptional: false, note: shell.sheet.querySelector('#as-note').value.trim() };
    if (t === 'day') out.id = shell.sheet.querySelector('#as-day').value;
    if (t === 'cardio') out.id = shell.sheet.querySelector('#as-cardio').value;
    if (t === 'day' || t === 'ballOptional') out.fallbackId = shell.sheet.querySelector('#as-fb').value || null;
    if (t === 'rest') out.ballOptional = shell.sheet.querySelector('#as-ball').checked;
    if ((t === 'day' || t === 'cardio') && !out.id) return (shell.errEl.textContent = '先选一个模板');
    let dateKey = date;
    if (withDate) {
      dateKey = shell.sheet.querySelector('#as-date').value;
      if (!parseDateKey(dateKey)) return (shell.errEl.textContent = '先选日期');
    }
    shell.done();
    onSave({ date: dateKey, assign: out });
    return undefined;
  };
  shell.sheet.appendChild(el('button', { class: 'btn-primary sheet-save', type: 'button', onclick: save }, '保存'));
  if (allowDelete) shell.sheet.appendChild(el('button', { class: 'btn-secondary sheet-cancel plan-delete', type: 'button', onclick: () => { shell.done(); onDelete(); } }, '删除这条调课'));
  shell.sheet.appendChild(el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: shell.close }, '取消'));
}

/* ---------- 训练日的动作列表 ---------- */

export function renderPlanDay(root, { template, saveError, onEditExercise, onMove, onRemove, onAdd, onBack }) {
  const rows = (template.exercises || []).map((ex, i, arr) =>
    el('li', { class: 'hist-row plan-ex-row' }, [
      el('button', { class: 'hist-row-btn', type: 'button', onclick: () => onEditExercise(ex.id) }, [
        el('span', { class: 'hist-date', text: ex.name }),
        el('span', { class: 'hist-type', text: formatSetsReps(ex) }),
        el('span', { class: 'hist-meta', text: `${formatLoad(ex.load)} · 休息 ${ex.restSeconds ?? '—'} 秒${(ex.alternates || []).length ? ` · 替代 ${alternatesToText(ex.alternates)}` : ''}${ex.notes ? ` · ${ex.notes}` : ''}` }),
      ]),
      el('div', { class: 'plan-ex-actions' }, [
        el('button', { class: 'btn-secondary', type: 'button', disabled: i === 0, 'aria-label': `${ex.name} 上移`, onclick: () => onMove(ex.id, -1) }, '上移'),
        el('button', { class: 'btn-secondary', type: 'button', disabled: i === arr.length - 1, 'aria-label': `${ex.name} 下移`, onclick: () => onMove(ex.id, 1) }, '下移'),
        el('button', { class: 'btn-secondary plan-delete', type: 'button', 'aria-label': `${ex.name} 删除`, onclick: () => onRemove(ex.id) }, '删除'),
      ]),
    ])
  );
  replaceChildren(root, [
    header(template.name, `${rows.length} 个动作${template.enabled === false ? ' · 未启用' : ''}`, onBack),
    saveError ? el('p', { class: 'problem save-error', text: saveError }) : null,
    rows.length ? el('ul', { class: 'hist-list', role: 'list' }, rows) : el('p', { class: 'muted', text: '还没有动作' }),
    el('div', { class: 'home-actions' }, [el('button', { class: 'btn-primary', type: 'button', onclick: onAdd }, '新增动作')]),
  ]);
}

/* ---------- 动作编辑表单 ---------- */

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function renderExerciseSheet(root, { title, exercise, onSave, onClose }) {
  const ex = exercise || {};
  const load = ex.load || {};
  const body = [
    textField('ex-name', '名称', ex.name, { maxlength: '30' }),
    textField('ex-muscle', '肌群（可选）', ex.muscle, { maxlength: '20' }),
    el('div', { class: 'set-inputs' }, [numField('ex-weight', '重量 lb（空 = 首次做时填）', load.bodyweight ? null : load.value, { step: '0.5', min: '0' }), textField('ex-label', '重量显示文字（可选）', load.label, { maxlength: '20', placeholder: '如 120 每边' })]),
    el('div', { class: 'plan-checks' }, [checkField('ex-bodyweight', '自重', load.bodyweight), checkField('ex-assisted', '助力（数值越小越难）', load.assisted), checkField('ex-perSideLoad', '每边配重', load.perSideLoad), checkField('ex-perSide', '每侧各做', ex.perSide)]),
    el('div', { class: 'set-inputs' }, [numField('ex-sets-min', '组数 最少', (ex.sets || {}).min ?? 3, { step: '1', min: '1' }), numField('ex-sets-max', '组数 目标', (ex.sets || {}).max ?? 3, { step: '1', min: '1' })]),
    el('div', { class: 'set-inputs' }, [numField('ex-reps-min', '次数 下限', (ex.reps || {}).min ?? 6, { step: '1', min: '1' }), numField('ex-reps-max', '次数 上限', (ex.reps || {}).max ?? 10, { step: '1', min: '1' })]),
    numField('ex-rest', '参考休息秒数', ex.restSeconds ?? 90, { step: '5', min: '0' }),
    textField('ex-alts', '替代动作（逗号分隔，可写 名称:重量）', alternatesToText(ex.alternates), { placeholder: '斜下胸推机器:45，哑铃推' }),
    textField('ex-notes', '备注（可选）', ex.notes, { maxlength: '80' }),
  ];
  const shell = sheetShell(root, title, body, { onClose });
  const q = (id) => shell.sheet.querySelector('#' + id);
  const save = () => {
    const name = q('ex-name').value.trim();
    if (!name) return (shell.errEl.textContent = '先填名称');
    const nums = { weight: toNum(q('ex-weight').value), setsMin: toNum(q('ex-sets-min').value), setsMax: toNum(q('ex-sets-max').value), repsMin: toNum(q('ex-reps-min').value), repsMax: toNum(q('ex-reps-max').value), restSeconds: toNum(q('ex-rest').value) };
    for (const k of ['setsMin', 'setsMax', 'repsMin', 'repsMax']) {
      if (nums[k] == null || !Number.isInteger(nums[k]) || nums[k] < 1) return (shell.errEl.textContent = '组数和次数要填 ≥1 的整数');
    }
    if (nums.setsMin > nums.setsMax || nums.repsMin > nums.repsMax) return (shell.errEl.textContent = '最少 / 下限不能大于目标 / 上限');
    if (Number.isNaN(nums.weight) || (nums.weight != null && nums.weight < 0)) return (shell.errEl.textContent = '重量不对');
    if (nums.restSeconds == null || nums.restSeconds < 0) return (shell.errEl.textContent = '休息秒数不对');
    shell.done();
    onSave({
      name,
      muscle: q('ex-muscle').value.trim(),
      ...nums,
      label: q('ex-label').value.trim(),
      bodyweight: q('ex-bodyweight').checked,
      assisted: q('ex-assisted').checked,
      perSideLoad: q('ex-perSideLoad').checked,
      perSide: q('ex-perSide').checked,
      alternatesText: q('ex-alts').value,
      notes: q('ex-notes').value.trim(),
    });
    return undefined;
  };
  shell.sheet.appendChild(el('button', { class: 'btn-primary sheet-save', type: 'button', onclick: save }, '保存'));
  shell.sheet.appendChild(el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: shell.close }, '取消'));
}
