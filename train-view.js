// train-view.js — 训练模式页面。只画 DOM；状态改动通过回调交给 app.js。
import { el, replaceChildren } from './dom.js';
import { formatLoad, formatRange } from './schedule.js';
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

function renderRow(entry, template, handlers) {
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
  if (active) {
    children.push(
      el('div', { class: 'train-actions' }, [
        el('button', { class: 'btn-primary', type: 'button', onclick: () => handlers.onCompleteSet(base.id) }, '完成一组'),
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
export function restClockState(session, template, now) {
  if (session.restStartedAt == null) {
    return { idle: true, text: '--:--', ready: false, meta: '完成一组后开始计时' };
  }
  const elapsedMs = now - session.restStartedAt;
  const reference = restReferenceSeconds(session, template);
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

function renderRestBar(session, template, now, onReset) {
  const st = restClockState(session, template, now);
  return el('div', { class: 'rest-bar' }, [
    el('div', { class: 'rest-main' }, [
      el('div', { class: `rest-time${st.idle ? ' rest-time-idle' : ''}${st.ready ? ' rest-time-ready' : ''}`, text: st.text, 'aria-live': 'off' }),
      el('div', { class: 'rest-meta', text: st.meta }),
    ]),
    el('button', { class: 'btn-secondary rest-reset', type: 'button', disabled: st.idle, onclick: onReset }, '重置'),
  ]);
}

// 每秒只更新秒表条的文字和颜色，不重画整页（spec 3.3：显示值 = 现在 − 时间戳）
export function updateRestClock(root, session, template, now) {
  const time = root.querySelector('.rest-time');
  const meta = root.querySelector('.rest-meta');
  if (!time || !meta) return;
  const st = restClockState(session, template, now);
  if (time.textContent !== st.text) time.textContent = st.text;
  if (meta.textContent !== st.meta) meta.textContent = st.meta;
  time.classList.toggle('rest-time-idle', st.idle);
  time.classList.toggle('rest-time-ready', st.ready);
}

export function renderTrain(root, { session, template, dateText, now, notice, onSelect, onCompleteSet, onUndo, onExtra, onEnd, onSkip, onUnskip, onPickAlternate, onBack, onFinish, onReset }) {
  const sum = summarize(session, template);
  const handlers = { onSelect, onCompleteSet, onUndo, onExtra, onEnd, onSkip, onUnskip, onPickAlternate };
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
      renderRestBar(session, template, now, onReset),
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
      el('div', { class: 'train-topline' }, [
        el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
        el('h1', { class: 'train-name', text: '训练' }),
      ]),
    ]),
    el('p', { class: 'muted', text: message }),
    onFinish
      ? el('div', { class: 'train-footer' }, [
          el('button', { class: 'btn-secondary btn-finish', type: 'button', onclick: onFinish }, '结束并保存这次训练'),
        ])
      : null,
  ]);
}
