// skip-view.js — "这天不练"的底部表单：跳过 / 顺延 / 压缩到某个打球日。只画 DOM。
import { el } from './dom.js';
import { shiftPreview, upcomingBallDays, fmtDay } from './skip-day.js';

// day：resolveDay 的结果；date：Date。onApply(mode, { ballDateKey })
export function renderSkipSheet(root, { plan, date, day, onApply, onClose }) {
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  document.addEventListener('keydown', onKey);
  const apply = (mode, extra) => {
    document.removeEventListener('keydown', onKey);
    onApply(mode, extra || {});
  };
  const errEl = el('p', { class: 'set-error', 'aria-live': 'polite' });
  const canMove = day.kind === 'strength' || day.kind === 'cardio';
  const { moves, consumedRest } = canMove ? shiftPreview(plan, date) : { moves: [], consumedRest: null };
  const balls = canMove ? upcomingBallDays(plan, date) : [];
  const ballSel = el('select', { class: 'sheet-select', id: 'skip-ball', 'aria-label': '压缩到哪个打球日' }, balls.map((b, i) => el('option', { value: b.dateKey, selected: i === 0 }, b.label)));

  const option = (title, desc, children) => el('section', { class: 'skip-option' }, [el('div', { class: 'skip-option-title', text: title }), desc ? el('p', { class: 'muted skip-option-desc', text: desc }) : null, ...[].concat(children)]);

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '这天不练', tabindex: '-1' }, [
    el('div', { class: 'sheet-title', text: `${fmtDay(date)} 不练 · 原本是 ${day.title}` }),
    option('跳过', '这天改成休息，后面的安排不变。', [el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('skip') }, '跳过这天')]),
    canMove
      ? option(
          '顺延',
          moves.length
            ? `后面的训练各往后挪一天，打球日不动${consumedRest ? `，${fmtDay(consumedRest)} 的休息被占掉` : '，挪满 14 天'}。`
            : '后面 14 天里没有可以挪的日子。',
          [
            moves.length ? el('ul', { class: 'skip-moves' }, moves.map((m) => el('li', { text: `${m.title}：${fmtDay(m.from)} → ${fmtDay(m.to)}` }))) : null,
            moves.length ? el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('shift') }, '顺延') : null,
          ]
        )
      : null,
    canMove
      ? option(
          '压缩打球日',
          balls.length ? `挑一个打球日，那天不打球，改练 ${day.title}。` : '后面 14 天里没有可选打球日。',
          balls.length
            ? [
                el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'skip-ball', text: '压缩到' }), ballSel]),
                el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('compress', { ballDateKey: ballSel.value }) }, `那天改练 ${day.title}`),
              ]
            : null
        )
      : null,
    errEl,
    el('p', { class: 'muted skip-hint', text: '改动都记在 计划 → 调课 里，不想要了可以在那里删掉。' }),
    el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: close }, '取消'),
  ]);
  root.appendChild(el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet]));
  sheet.focus();
}
