// activity-view.js — 打球 / 有氧 / 散步的记录选单、本周 7 天小条、今天已记录列表。只画 DOM。
import { el } from './dom.js';
import { WEEKDAY_LABELS } from './schedule.js';
import { describeActivity } from './activity.js';

function toInt(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

// 底部选单表单。kind：ball | cardio | walk。保存时 onSave({ minutes, avgHr, zone3Min, note })
// initial：改已有记录时的初始值 { minutes, avgHr, zone3Min, note }
export function renderActivitySheet(root, { kind, title, defaultMinutes, warning, initial = null, onSave, onClose }) {
  const numField = (id, label, value) =>
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: id, text: label }),
      el('input', { class: 'num sheet-input', id, type: 'number', inputmode: 'numeric', min: '0', step: '1', value: value == null ? '' : String(value) }),
    ]);
  const errEl = el('p', { class: 'set-error', 'aria-live': 'polite' });
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  document.addEventListener('keydown', onKey);
  const save = () => {
    const minutes = toInt(sheet.querySelector('#act-minutes').value);
    const avgHr = toInt(sheet.querySelector('#act-hr').value);
    const z3El = sheet.querySelector('#act-z3');
    const zone3Min = z3El ? toInt(z3El.value) : null;
    const noteEl = sheet.querySelector('#act-note');
    const note = noteEl ? noteEl.value.trim() : '';
    if (minutes == null || !(minutes >= 1)) return (errEl.textContent = '先填时长（分钟）');
    if (avgHr != null && !(avgHr >= 30 && avgHr <= 250)) return (errEl.textContent = '平均心率要在 30–250 之间');
    if (zone3Min != null && !(zone3Min >= 0 && zone3Min <= minutes)) return (errEl.textContent = 'Zone3+ 分钟不能超过时长');
    errEl.textContent = '';
    document.removeEventListener('keydown', onKey);
    onSave({ minutes, avgHr, zone3Min, note });
    return undefined;
  };
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' }, [
    el('div', { class: 'sheet-title', text: title }),
    warning ? el('p', { class: 'today-note sheet-warning', text: warning }) : null,
    el('div', { class: 'set-inputs' }, [numField('act-minutes', '时长（分钟）', initial ? initial.minutes : defaultMinutes), numField('act-hr', '平均心率（可选）', initial ? initial.avgHr : null)]),
    kind === 'ball' ? el('div', { class: 'set-inputs set-inputs-single' }, [numField('act-z3', 'Zone3+ 分钟（可选）', initial ? initial.zone3Min : null)]) : null,
    kind !== 'ball'
      ? el('div', { class: 'field' }, [
          el('label', { class: 'field-label', for: 'act-note', text: '备注（可选）' }),
          el('input', { class: 'sheet-text', id: 'act-note', type: 'text', maxlength: '60', placeholder: '例如：坡度快走 8%', value: initial && initial.note ? initial.note : '' }),
        ])
      : null,
    errEl,
    el('button', { class: 'btn-primary sheet-save', type: 'button', onclick: save }, '保存'),
    el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: close }, '取消'),
  ]);
  root.appendChild(el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet]));
  const first = sheet.querySelector('#act-minutes');
  if (first) first.focus();
}

// 本周 7 天小条（周一到周日）+ 本周球次数
export function renderWeekStrip({ summary, todayKey, ballCount, limit }) {
  const warn = ballCount >= limit;
  return el('section', { class: 'week' }, [
    el('div', { class: 'week-strip', role: 'list', 'aria-label': '本周' }, summary.map((d, i) =>
      el('div', { class: `week-day${d.key === todayKey ? ' week-today' : ''}${d.done ? ' week-done' : ''}`, role: 'listitem' }, [
        el('span', { class: 'week-label', text: WEEKDAY_LABELS[(i + 1) % 7].replace('周', '') }),
        el('span', { class: 'week-mark', text: d.ball ? '球' : d.done ? '✓' : '·', 'aria-label': d.ball ? '打球' : d.done ? '已完成' : '无记录' }),
      ])
    )),
    el('div', { class: `week-ball${warn ? ' week-ball-warn' : ''}`, text: `本周打球 ${ballCount} 次${warn ? ` · 已到每周 ${limit} 次上限` : ''}` }),
  ]);
}

// 今天已记录的打球 / 有氧 / 散步
export function renderTodayActivities(list, plan) {
  if (!list.length) return null;
  return el('section', { class: 'card today-acts' }, [
    el('div', { class: 'row-label', text: '今天已记录' }),
    ...list.map((s) => el('div', { class: 'row', text: describeActivity(s, plan) })),
  ]);
}
