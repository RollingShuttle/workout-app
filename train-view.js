// train-view.js — 训练模式页面。只画 DOM；状态改动通过回调交给 app.js。
import { el, replaceChildren } from './dom.js';
import { formatLoad, formatRange } from './schedule.js';
import { findExercise, targetSets, completedSets, nextSide, orderedEntries, summarize, canCancelExtraSet } from './workout.js';

function renderRow(entry, template, handlers) {
  const ex = findExercise(template, entry.exerciseId);
  if (!ex) {
    return el('li', { class: 'train-row' }, el('p', { class: 'problem', text: `找不到动作 ${entry.exerciseId}` }));
  }
  const done = entry.status === 'done';
  const active = entry.status === 'active';
  const count = `${completedSets(entry, ex)}/${targetSets(ex, entry)}`;
  const side = nextSide(entry, ex);
  const meta = [formatLoad(ex.load), `${formatRange(ex.reps)} 次`, ex.perSide ? '每侧' : null].filter(Boolean).join(' · ');
  // 每侧动作做完左侧、还没做右侧时提示半组；撤销按钮说清撤的是哪半边
  const countText = side === 'R' ? `${count} · 左侧已做` : count;
  const last = entry.sets[entry.sets.length - 1];
  const undoLabel = canCancelExtraSet(entry, ex)
    ? '取消再加一组'
    : last && last.side === 'L' ? '撤销左侧' : last && last.side === 'R' ? '撤销右侧' : '撤销最后一组';

  const head = el(
    'button',
    {
      class: 'train-row-head',
      type: 'button',
      disabled: done, // 完成的动作点击无反应（spec 3.2 防重复）
      'aria-expanded': String(active),
      onclick: () => handlers.onSelect(ex.id),
    },
    [
      el('span', { class: 'train-row-name', text: done ? `✓ ${ex.name}` : ex.name }),
      el('span', { class: 'train-row-count', text: countText }),
      el('span', { class: 'train-row-meta', text: meta }),
    ]
  );

  const children = [head];
  if (active) {
    const label = side === 'L' ? '完成左侧' : side === 'R' ? '完成右侧' : '完成一组';
    children.push(
      el('div', { class: 'train-actions' }, [
        el('button', { class: 'btn-primary', type: 'button', onclick: () => handlers.onCompleteSet(ex.id) }, label),
        entry.sets.length > 0 || canCancelExtraSet(entry, ex)
          ? el('button', { class: 'btn-secondary', type: 'button', onclick: () => handlers.onUndo(ex.id) }, undoLabel)
          : null,
      ])
    );
  } else if (done) {
    children.push(
      el('div', { class: 'train-actions train-actions-done' }, [
        el('button', { class: 'btn-secondary', type: 'button', onclick: () => handlers.onUndo(ex.id) }, undoLabel),
        el('button', { class: 'btn-secondary', type: 'button', onclick: () => handlers.onExtra(ex.id) }, '再加一组'),
      ])
    );
  }
  return el('li', { class: `train-row train-row-${entry.status}`, 'data-exercise': ex.id }, children);
}

export function renderTrain(root, { session, template, dateText, notice, onSelect, onCompleteSet, onUndo, onExtra, onBack, onFinish }) {
  const sum = summarize(session, template);
  const handlers = { onSelect, onCompleteSet, onUndo, onExtra };
  replaceChildren(root, [
    el('header', { class: 'train-header' }, [
      el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
      el('div', { class: 'train-title' }, [
        el('h1', { class: 'train-name', text: template.name }),
        el('div', {
          class: 'train-sub',
          text: `${dateText} · 完成 ${sum.doneExercises}/${sum.totalExercises} 个动作 · ${sum.totalSets} 组`,
        }),
      ]),
    ]),
    notice ? el('p', { class: 'problem save-error', text: notice }) : null,
    el(
      'ul',
      { class: 'train-list', role: 'list' },
      orderedEntries(session).map((entry) => renderRow(entry, template, handlers))
    ),
    el('div', { class: 'train-footer' }, [
      el('button', { class: 'btn-secondary btn-finish', type: 'button', onclick: onFinish }, '结束训练'),
    ]),
  ]);
}

// 进不了训练页时的提示：今天不是力量日，或草稿的模板找不到了（此时给一个结束入口，别把人卡死）
export function renderTrainUnavailable(root, { message, onBack, onFinish }) {
  replaceChildren(root, [
    el('header', { class: 'train-header' }, [
      el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
      el('h1', { class: 'train-name', text: '训练' }),
    ]),
    el('p', { class: 'muted', text: message }),
    onFinish
      ? el('div', { class: 'train-footer' }, [
          el('button', { class: 'btn-secondary btn-finish', type: 'button', onclick: onFinish }, '结束并保存这次训练'),
        ])
      : null,
  ]);
}
