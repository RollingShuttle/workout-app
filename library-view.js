// library-view.js — 底部"动作"页：动作库里的每个动作单独设置（用户 2026-11-13）。只画 DOM。
// 列表按肌群分组；点一个进 #exercise/<id>（设置 + 记录折线，history-view.js renderExerciseChart）。
// 不显示"替代动作"：替代关系以后放到训练日里按肌群放几个动作（docs/exercise-library-plan.md 第 2 步）。
import { el, replaceChildren } from './dom.js';
import { formatLoad, formatSetsReps } from './schedule.js';
import { templatesUsing } from './exercise-library.js';

function header(title, sub) {
  return el('header', { class: 'train-header' }, [
    el('div', { class: 'train-topline' }, [
      el('div', { class: 'train-title' }, [
        el('h1', { class: 'train-name', text: title }),
        sub ? el('div', { class: 'train-sub', text: sub }) : null,
      ]),
    ]),
  ]);
}

// 肌群分组：按训练日里第一次出现的顺序，没排进训练日的动作排在后面；没写肌群的归"未分组"
export function groupByMuscle(plan) {
  const lib = plan.library || {};
  const order = [];
  const seen = new Set();
  for (const t of plan.dayTemplates || []) {
    for (const ex of t.exercises || []) {
      if (ex && !seen.has(ex.id)) {
        seen.add(ex.id);
        order.push(ex.id);
      }
    }
  }
  for (const ex of plan.exercises || []) if (!seen.has(ex.id)) order.push(ex.id);
  const groups = new Map();
  for (const id of order) {
    const ex = lib[id];
    if (!ex) continue;
    const key = (ex.muscle || '').trim() || '未分组';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ex);
  }
  return [...groups.entries()].map(([muscle, list]) => ({ muscle, list }));
}

export function renderLibrary(root, { plan, saveError, onOpen, onAdd }) {
  const groups = groupByMuscle(plan);
  const total = groups.reduce((n, g) => n + g.list.length, 0);
  const row = (ex) => {
    const days = templatesUsing(plan, ex.id).map((t) => t.name);
    return el('li', { class: 'hist-row' }, [
      el('button', { class: 'hist-row-btn lib-row-btn', type: 'button', onclick: () => onOpen(ex.id) }, [
        el('span', { class: 'hist-date', text: ex.name }),
        el('span', { class: 'hist-type', text: formatSetsReps(ex) }),
        el('span', { class: 'hist-meta', text: `${formatLoad(ex.load)} · ${days.length ? days.join('、') : '没排进训练日'}` }),
      ]),
    ]);
  };
  replaceChildren(root, [
    header('动作', `${total} 个动作 · 点一个看设置和记录`),
    saveError ? el('p', { class: 'problem save-error', text: saveError }) : null,
    el('div', { class: 'home-actions' }, [el('button', { class: 'btn-secondary link-btn', type: 'button', onclick: onAdd }, '新增动作')]),
    ...groups.map((g) =>
      el('section', { class: 'plan-section' }, [
        el('h2', { class: 'plan-section-title', text: g.muscle }),
        el('ul', { class: 'hist-list', role: 'list' }, g.list.map(row)),
      ])
    ),
    total ? null : el('p', { class: 'muted', text: '动作库是空的。点"新增动作"加一个，或者到 设置 里载入内置计划。' }),
  ]);
}
