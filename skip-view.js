// skip-view.js — "调整这天"的底部表单：改成练什么 / 不练（跳过 / 顺延 / 压缩到某个打球日）/ 撤销调课。只画 DOM。
import { el } from './dom.js';
import { shiftPreview, upcomingBallDays, fmtDay, applySkip, newConflicts, canSkip, dayChoices, batchDates } from './skip-day.js';

// 某种处理方案会不会撞上排程规则：撞了就列出来（橙色），由用户决定
function conflictList(plan, date, mode, extra) {
  const r = applySkip(plan, date, mode, extra);
  if (!r.plan) return null;
  const list = newConflicts(plan, r.plan, date);
  if (!list.length) return el('p', { class: 'muted skip-ok', text: '不撞排程规则。' });
  return el('ul', { class: 'skip-warn' }, list.map((c) => el('li', { text: `⚠ ${c.text}` })));
}

// day：resolveDay 的结果；date：Date。onApply(mode, extra)：mode = 'set' | 'skip' | 'shift' | 'compress' | 'undo'
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
  const option = (title, desc, children) => el('section', { class: 'skip-option' }, [el('div', { class: 'skip-option-title', text: title }), desc ? el('p', { class: 'muted skip-option-desc', text: desc }) : null, ...[].concat(children)]);

  // 改成练什么
  const choices = dayChoices(plan);
  const choiceSel = el('select', { class: 'sheet-select', id: 'skip-set', 'aria-label': '改成' }, choices.map((c, i) => el('option', { value: c.value, selected: i === 0 }, c.label)));
  const setBlock = option('改成', '直接指定这天练什么。指定的训练日不轮流（选哪个就是哪个）。', [
    el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'skip-set', text: '这天改成' }), choiceSel]),
    el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('set', { choice: choiceSel.value }) }, '就这样'),
  ]);

  // 不练
  const skippable = canSkip(day);
  const canMove = day.kind === 'strength' || day.kind === 'cardio';
  const { moves, consumedRest } = canMove ? shiftPreview(plan, date) : { moves: [], consumedRest: null };
  const balls = canMove ? upcomingBallDays(plan, date) : [];
  const compressWarn = el('div', { class: 'skip-warn-box' });
  const ballSel = el(
    'select',
    { class: 'sheet-select', id: 'skip-ball', 'aria-label': '压缩到哪个打球日', onchange: () => { compressWarn.replaceChildren(conflictList(plan, date, 'compress', { ballDateKey: ballSel.value }) || ''); } },
    balls.map((b, i) => el('option', { value: b.dateKey, selected: i === 0 }, b.label))
  );
  if (balls.length) compressWarn.replaceChildren(conflictList(plan, date, 'compress', { ballDateKey: balls[0].dateKey }) || '');
  const skipBlocks = skippable
    ? [
        option('不练 · 跳过', '这天改成休息，后面的安排不变。', [el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('skip') }, '跳过这天')]),
        canMove
          ? option(
              '不练 · 顺延',
              moves.length
                ? `后面的训练各往后挪一天，打球日不动${consumedRest ? `，${fmtDay(consumedRest)} 的休息被占掉` : '，挪满 14 天'}。`
                : '后面 14 天里没有可以挪的日子。',
              [
                moves.length ? el('ul', { class: 'skip-moves' }, moves.map((m) => el('li', { text: `${m.title}：${fmtDay(m.from)} → ${fmtDay(m.to)}` }))) : null,
                moves.length ? conflictList(plan, date, 'shift') : null,
                moves.length ? el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('shift') }, '顺延') : null,
              ]
            )
          : null,
        canMove
          ? option(
              '不练 · 压缩打球日',
              balls.length ? `挑一个打球日，那天不打球，改练 ${day.title}。` : '后面 14 天里没有可选打球日。',
              balls.length
                ? [
                    el('div', { class: 'field' }, [el('label', { class: 'field-label', for: 'skip-ball', text: '压缩到' }), ballSel]),
                    compressWarn,
                    el('button', { class: 'btn-secondary skip-btn', type: 'button', onclick: () => apply('compress', { ballDateKey: ballSel.value }) }, `那天改练 ${day.title}`),
                  ]
                : null
            )
          : null,
      ]
    : [];

  // 撤销调课
  const dates = day.source === 'override' ? batchDates(plan, date) : [];
  const undoBlock =
    day.source === 'override'
      ? option(
          '撤销调课',
          dates.length > 1 ? `这天的调课是某次"不练"一起改出来的，撤销会把这 ${dates.length} 天都恢复成每周安排：${dates.map((k) => k.slice(5).replace('-', '/')).join('、')}。` : '把这天恢复成每周安排。',
          [el('button', { class: 'btn-secondary skip-btn plan-delete', type: 'button', onclick: () => apply('undo') }, dates.length > 1 ? `撤销这 ${dates.length} 天的调课` : '撤销这天的调课')]
        )
      : null;

  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '调整这天', tabindex: '-1' }, [
    el('div', { class: 'sheet-title', text: `调整 ${fmtDay(date)} · 现在是 ${day.title}${day.source === 'override' ? '（调课）' : ''}` }),
    setBlock,
    ...skipBlocks,
    undoBlock,
    el('p', { class: 'muted skip-hint', text: '改动都记在 计划 → 调课 里，也能在那里删。' }),
    el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: close }, '取消'),
  ]);
  root.appendChild(el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet]));
  sheet.focus();
}
