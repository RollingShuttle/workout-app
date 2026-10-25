// train-view.js — 训练模式页面。只画 DOM；状态改动通过回调交给 app.js。
import { el, replaceChildren } from './dom.js';
import { lbToDisplay, displayToLb, displayUnit, weightStep } from './units.js';
import { formatLoad, formatRange } from './schedule.js';
import { formatSets } from './history.js';
import {
  findExercise,
  findEntry,
  targetSets,
  completedSets,
  orderedEntries,
  summarize,
  canCancelExtraSet,
  canEndExercise,
  effectiveExercise,
  restReferenceSeconds,
} from './workout.js';

function fmtDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  return m ? `${Number(m[2])}月${Number(m[3])}日` : key || '';
}

function toNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 一个数字输入框 + 左右 ± 按钮。改值只改 DOM 和 handlers.onInput 里的暂存，不重画整页（否则会丢焦点）
function numberField({ id, label, value, delta, step, min, inputmode, onChange }) {
  const input = el('input', {
    class: 'num',
    id,
    type: 'number',
    inputmode,
    step: String(step),
    min: String(min),
    value: value == null ? '' : String(value),
    oninput: () => onChange(toNumber(input.value)),
  });
  const bump = (sign) => {
    const cur = toNumber(input.value);
    if (cur == null && sign < 0) return; // 空着的必填项按"−"不要变成 0
    const base = cur ?? 0;
    const next = Math.max(min, Math.round((base + sign * delta) / step) * step);
    input.value = String(Number(next.toFixed(2)));
    onChange(toNumber(input.value));
  };
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: id, text: label }),
    el('div', { class: 'stepper' }, [
      el('button', { class: 'step', type: 'button', 'aria-label': `${label} 减 ${delta}`, onclick: () => bump(-1) }, '−'),
      input,
      el('button', { class: 'step', type: 'button', 'aria-label': `${label} 加 ${delta}`, onclick: () => bump(1) }, '+'),
    ]),
  ]);
}

function renderSetInputs(entry, base, ex, ctx, handlers) {
  const load = ex.load || {};
  const bodyweight = Boolean(load.bodyweight);
  const setIndex = entry.sets.length;
  const alt = entry.usedAlternate ?? null;
  const pre = ctx.prefill(entry, ex);
  const t = ctx.inputs;
  // 暂存值只在同一次训练、同一动作、同一替代口径、同一组号下才拿来用
  const typed =
    t && t.sessionId === ctx.sessionId && t.exerciseId === base.id && (t.usedAlternate ?? null) === alt && t.setIndex === setIndex
      ? t
      : {};
  const weightVal = 'weight' in typed ? typed.weight : lbToDisplay(pre.weight); // 输入框里的值按显示单位
  const repsVal = 'reps' in typed ? typed.reps : pre.reps;
  const u = displayUnit();
  const weightLabel = load.assisted ? `助力 ${u}` : load.perSideLoad ? `每边 ${u}` : `重量 ${u}`;
  const errEl = el('p', { class: 'set-error', 'aria-live': 'polite' });
  const onChange = (field) => (value) => {
    errEl.textContent = ''; // 改值就清提示；下次报错是从空变有，VoiceOver 才会读
    handlers.onInput({ sessionId: ctx.sessionId, exerciseId: base.id, usedAlternate: alt, setIndex }, field, value);
  };
  const last = ctx.last(entry);
  const fields = [];
  if (!bodyweight) {
    fields.push(numberField({ id: `inp-${base.id}-weight`, label: weightLabel, value: weightVal, delta: weightStep().delta, step: weightStep().step, min: 0, inputmode: 'decimal', onChange: onChange('weight') }));
  }
  fields.push(numberField({ id: `inp-${base.id}-reps`, label: '次数', value: repsVal, delta: 1, step: 1, min: 1, inputmode: 'numeric', onChange: onChange('reps') }));
  return el('div', { class: 'set-entry' }, [
    el('p', { class: 'last-ref', text: lastRefText(last, bodyweight, ctx.historyLoaded) }),
    el('div', { class: `set-inputs${bodyweight ? ' set-inputs-single' : ''}` }, fields),
    errEl,
  ]);
}

function lastRefText(last, bodyweight, historyLoaded) {
  if (last) return `上次（${fmtDateKey(last.date)}）：${formatSets(last.sets, { bodyweight })}`;
  return historyLoaded ? '没有上次记录' : '上次记录读取中…';
}

// 历史读回来时只更新"上次"那一行，不重画整页（用户可能正在输入框里打字）
export function updateLastRef(root, session, template, lastFor) {
  root.querySelectorAll('.train-row-active').forEach((rowEl) => {
    const entry = session.entries.find((e) => e.exerciseId === rowEl.dataset.exercise);
    const base = entry && findExercise(template, entry.exerciseId);
    const line = rowEl.querySelector('.last-ref');
    if (!entry || !base || !line) return;
    const ex = effectiveExercise(entry, base);
    line.textContent = lastRefText(lastFor(entry), Boolean((ex.load || {}).bodyweight), true);
  });
}

// 点"完成一组"时从输入框读值并校验；不合法就在行内提示，不记组
function readSetInputs(rowEl, base, ex) {
  const load = ex.load || {};
  const bodyweight = Boolean(load.bodyweight);
  const weightEl = rowEl.querySelector(`#inp-${CSS.escape(base.id)}-weight`);
  const repsEl = rowEl.querySelector(`#inp-${CSS.escape(base.id)}-reps`);
  const weight = bodyweight ? null : toNumber(weightEl && weightEl.value);
  const reps = toNumber(repsEl && repsEl.value);
  if (!bodyweight && (weight == null || weight < 0)) return { error: '先填这一组的重量' };
  if (reps == null || reps < 1 || !Number.isInteger(reps)) return { error: '先填这一组的次数（整数）' };
  return { weight: displayToLb(weight), reps }; // 存 lb
}

function renderRow(entry, template, handlers, ctx) {
  const base = findExercise(template, entry.exerciseId);
  if (!base) {
    return el('li', { class: 'train-row' }, el('p', { class: 'problem', text: `找不到动作 ${entry.exerciseId}` }));
  }
  const ex = effectiveExercise(entry, base); // 选了替代动作就显示替代动作的名字和重量
  const done = entry.status === 'done';
  const skipped = entry.status === 'skipped';
  const active = entry.status === 'active';
  const count = skipped ? '已跳过' : `${completedSets(entry, base)}/${targetSets(base, entry)}`;
  // 每侧动作：两侧都做完再按一次"完成一组"，所以这里只提示"每侧"，不分左右
  const metaParts = [formatLoad(ex.load), `${formatRange(base.reps)} 次`, base.perSide ? '每侧' : null];
  if (entry.usedAlternate) metaParts.unshift(`替代 ${base.name}`);
  const meta = metaParts.filter(Boolean).join(' · ');
  const undoLabel = canCancelExtraSet(entry, base) ? '取消再加一组' : '撤销最后一组';
  const sets = base.sets || {};
  const showEnd = (sets.min ?? 0) < (sets.max ?? 0); // min === max 的动作做满自动完成，不需要"结束动作"
  const btn = (label, handler, attrs = {}) =>
    el('button', { class: 'btn-secondary', type: 'button', onclick: handler, ...attrs }, label);

  const head = el(
    'button',
    {
      class: 'train-row-head',
      type: 'button',
      disabled: done || skipped, // 完成/跳过的动作点击无反应（spec 3.2 防重复）
      'aria-expanded': String(active),
      onclick: () => handlers.onSelect(base.id),
    },
    [
      el('span', { class: 'train-row-name', text: done ? `✓ ${ex.name}` : ex.name }),
      el('span', { class: 'train-row-count', text: count }),
      el('span', { class: 'train-row-meta', text: meta }),
    ]
  );

  const children = [head];
  // 进阶 / 退阶提示：只提示，不改计划；完成或跳过的行不显示
  const suggestion = !done && !skipped && ctx.suggest ? ctx.suggest(entry, base) : null;
  if (suggestion) {
    children.push(el('div', { class: `train-hint train-hint-${suggestion.kind}`, text: `${suggestion.kind === 'up' ? '↑' : '↓'} ${suggestion.text}` }));
  }
  if (entry.sets.length > 0 && !active) {
    children.push(el('div', { class: 'train-row-sets', text: formatSets(entry.sets, { bodyweight: Boolean((ex.load || {}).bodyweight) }) }));
  }
  if (active) {
    const complete = () => {
      const rowEl = document.querySelector(`[data-exercise="${CSS.escape(base.id)}"]`);
      if (!rowEl) return;
      const values = readSetInputs(rowEl, base, ex);
      const errEl = rowEl.querySelector('.set-error');
      if (values.error) {
        if (errEl) errEl.textContent = values.error;
        return;
      }
      if (errEl) errEl.textContent = '';
      handlers.onCompleteSet(base.id, { weight: values.weight, reps: values.reps });
    };
    children.push(
      el('div', { class: 'train-actions' }, [
        renderSetInputs(entry, base, ex, ctx, handlers),
        el('button', { class: 'btn-primary', type: 'button', onclick: complete }, '完成一组'),
        el('div', { class: 'train-secondary' }, [
          entry.sets.length > 0 || canCancelExtraSet(entry, base) ? btn(undoLabel, () => handlers.onUndo(base.id)) : null,
          showEnd ? btn('结束动作', () => handlers.onEnd(base.id), { disabled: !canEndExercise(entry, base) }) : null,
          btn('跳过', () => handlers.onSkip(base.id)),
          (base.alternates || []).length > 0 ? btn('换替代动作', () => handlers.onPickAlternate(base.id)) : null,
        ]),
      ])
    );
  } else if (done) {
    children.push(
      el('div', { class: 'train-actions train-actions-done' }, [
        btn(undoLabel, () => handlers.onUndo(base.id)),
        btn(entry.endedEarly ? '继续这个动作' : '再加一组', () => handlers.onExtra(base.id)),
      ])
    );
  } else if (skipped) {
    children.push(el('div', { class: 'train-actions train-actions-done' }, [btn('取消跳过', () => handlers.onUnskip(base.id))]));
  }
  return el('li', { class: `train-row train-row-${entry.status}`, 'data-exercise': base.id }, children);
}

// 换替代动作的底部选单：原动作 + 各替代动作（带重量）+ 取消
export function renderAlternateSheet(root, { entry, exercise, onPick, onClose }) {
  const item = (label, sub, handler, selected) =>
    el('button', { class: `sheet-item${selected ? ' sheet-item-selected' : ''}`, type: 'button', onclick: handler }, [
      el('span', { class: 'sheet-item-name', text: label }),
      sub ? el('span', { class: 'sheet-item-sub', text: sub }) : null,
    ]);
  // Escape 关闭；选单一出现就拿焦点（VoiceOver / 外接键盘）
  const onKey = (e) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey);
      onClose();
    }
  };
  document.addEventListener('keydown', onKey);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  const pick = (name) => {
    document.removeEventListener('keydown', onKey);
    onPick(name);
  };
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '换替代动作', tabindex: '-1' }, [
        el('div', { class: 'sheet-title', text: `${exercise.name} · 换替代动作` }),
        item(`原动作：${exercise.name}`, formatLoad(exercise.load), () => pick(null), !entry.usedAlternate),
        ...(exercise.alternates || []).map((a) =>
          item(a.name, a.load ? formatLoad(a.load) : '重量未填', () => pick(a.name), entry.usedAlternate === a.name)
        ),
        el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: close }, '取消'),
      ]);
  root.appendChild(
    el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet])
  );
  sheet.focus();
}


// mm:ss；封顶 99:59（用户决定），再久也只显示 99:59
export const CLOCK_CAP_SECONDS = 99 * 60 + 59;

export function formatClock(ms) {
  const total = Math.min(CLOCK_CAP_SECONDS, Math.max(0, Math.floor(ms / 1000)));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// 组间秒表条的内容：只依赖 session 里的时间戳和 now，不累加
export function restClockState(session, template, now, defaultRest = 90) {
  if (session.restStartedAt == null) {
    const canStart = session.lastSetCompletedAt != null; // 自动休息关着：做完一组后手动起表
    return { idle: true, canStart, text: '--:--', ready: false, meta: canStart ? '按「开始计时」开始休息计时' : '完成一组后开始计时' };
  }
  const elapsedMs = now - session.restStartedAt;
  const reference = restReferenceSeconds(session, template, defaultRest);
  const base = session.lastSetExerciseId ? findExercise(template, session.lastSetExerciseId) : null;
  const entry = session.lastSetExerciseId ? findEntry(session, session.lastSetExerciseId) : null;
  const exercise = base && entry ? effectiveExercise(entry, base) : base; // 换了替代动作就显示替代动作名
  return {
    idle: false,
    text: formatClock(elapsedMs),
    ready: elapsedMs >= reference * 1000,
    meta: `参考 ${formatClock(reference * 1000)}${exercise ? ` · ${exercise.name}` : ''}`,
  };
}

function renderRestBar(session, template, now, onReset, defaultRest) {
  const st = restClockState(session, template, now, defaultRest);
  return el('div', { class: 'rest-bar' }, [
    el('div', { class: 'rest-main' }, [
      el('div', { class: `rest-time${st.idle ? ' rest-time-idle' : ''}${st.ready ? ' rest-time-ready' : ''}`, text: st.text, 'aria-live': 'off' }),
      el('div', { class: 'rest-meta', text: st.meta }),
    ]),
    el('button', { class: 'btn-secondary rest-reset', type: 'button', disabled: st.idle && !st.canStart, onclick: onReset }, st.idle ? '开始计时' : '重置'),
  ]);
}

// 每秒只更新秒表条的文字和颜色，不重画整页（spec 3.3：显示值 = 现在 − 时间戳）
export function updateRestClock(root, session, template, now, defaultRest = 90) {
  const time = root.querySelector('.rest-time');
  const meta = root.querySelector('.rest-meta');
  if (!time || !meta) return;
  const st = restClockState(session, template, now, defaultRest);
  if (time.textContent !== st.text) time.textContent = st.text;
  if (meta.textContent !== st.meta) meta.textContent = st.meta;
  time.classList.toggle('rest-time-idle', st.idle);
  time.classList.toggle('rest-time-ready', st.ready);
  const btn = root.querySelector('.rest-reset');
  if (btn) {
    const label = st.idle ? '开始计时' : '重置';
    if (btn.textContent !== label) btn.textContent = label;
    btn.disabled = st.idle && !st.canStart;
  }
}

export function renderTrain(root, { session, template, dateText, now, notice, prefill, last, suggest, inputs, historyLoaded, defaultRestSeconds = 90, onSelect, onCompleteSet, onUndo, onExtra, onEnd, onSkip, onUnskip, onPickAlternate, onInput, onBack, onFinish, onDiscard, onReset }) {
  const sum = summarize(session, template);
  const handlers = { onSelect, onCompleteSet, onUndo, onExtra, onEnd, onSkip, onUnskip, onPickAlternate, onInput };
  const ctx = { prefill, last, suggest, inputs, historyLoaded, sessionId: session.id };
  replaceChildren(root, [
    el('header', { class: 'train-header' }, [
      el('div', { class: 'train-topline' }, [
        el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
        el('div', { class: 'train-title' }, [
          el('h1', { class: 'train-name', text: template.name }),
          el('div', {
            class: 'train-sub',
            text: `${dateText} · 完成 ${sum.doneExercises}/${sum.totalExercises} 个动作 · ${sum.totalSets} 组`,
          }),
        ]),
      ]),
      renderRestBar(session, template, now, onReset, defaultRestSeconds),
    ]),
    notice ? el('p', { class: 'problem save-error', text: notice }) : null,
    el(
      'ul',
      { class: 'train-list', role: 'list' },
      orderedEntries(session).map((entry) => renderRow(entry, template, handlers, ctx))
    ),
    el('div', { class: 'train-footer' }, [
      el('button', { class: 'btn-secondary btn-finish', type: 'button', onclick: onFinish }, '结束训练'),
      // 试玩 / 测试时用：不保存，直接删掉这次的草稿
      onDiscard ? el('button', { class: 'btn-secondary btn-discard', type: 'button', onclick: onDiscard }, '放弃这次训练（不保存）') : null,
    ]),
  ]);
}

// 进不了训练页时的提示：今天不是力量日，或草稿的模板找不到了（此时给一个结束入口，别把人卡死）
export function renderTrainUnavailable(root, { message, onBack, onFinish, onDiscard }) {
  replaceChildren(root, [
    el('header', { class: 'train-header' }, [
      el('div', { class: 'train-topline' }, [
        el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
        el('h1', { class: 'train-name', text: '训练' }),
      ]),
    ]),
    el('p', { class: 'muted', text: message }),
    onFinish || onDiscard
      ? el('div', { class: 'train-footer' }, [
          onFinish ? el('button', { class: 'btn-secondary btn-finish', type: 'button', onclick: onFinish }, '结束并保存这次训练') : null,
          onDiscard ? el('button', { class: 'btn-secondary btn-discard', type: 'button', onclick: onDiscard }, '放弃这次训练（不保存）') : null,
        ])
      : null,
  ]);
}

// 结束训练的汇总（spec 3.2）：总组数、用时、每个动作的最佳组；确认才保存。
// rows: [{ name, status: 'done' | 'partial' | 'skipped' | 'none', text }]
export function renderFinishSheet(root, { title, totalSets, minutes, rows, onConfirm, onClose }) {
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    onClose();
  };
  document.addEventListener('keydown', onKey);
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': '结束训练', tabindex: '-1' }, [
    el('div', { class: 'sheet-title', text: '结束训练' }),
    el('p', { class: 'finish-total', text: `${title} · 共 ${totalSets} 组 · 用时 ${minutes} 分钟` }),
    el(
      'ul',
      { class: 'finish-list', role: 'list' },
      rows.map((r) =>
        el('li', { class: `finish-row finish-${r.status}` }, [el('span', { class: 'finish-name', text: r.name }), el('span', { class: 'finish-meta', text: r.text })])
      )
    ),
    el('button', { class: 'btn-primary sheet-save', type: 'button', onclick: () => { document.removeEventListener('keydown', onKey); onConfirm(); } }, '保存并结束'),
    el('button', { class: 'btn-secondary sheet-cancel', type: 'button', onclick: close }, '继续训练'),
  ]);
  root.appendChild(
    el('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, [sheet])
  );
  sheet.focus();
}
