// history-view.js — 历史列表、单次训练详情、动作折线。只画 DOM；数据由 app.js 传入。
import { el, replaceChildren } from './dom.js';
import { WEEKDAY_LABELS, parseDateKey, formatLoad } from './schedule.js';
import { formatSets } from './history.js';
import { findExercise, effectiveExercise, activeDurationMs } from './workout.js';
import { describeActivity } from './activity.js';

function fmtDate(key) {
  const d = parseDateKey(key);
  return d ? `${d.getMonth() + 1}月${d.getDate()}日 · ${WEEKDAY_LABELS[d.getDay()]}` : key || '';
}

function fmtShortDate(key) {
  const d = parseDateKey(key);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : key || '';
}

// 时长 = 实际活动时段之和（跨天续练不算成一整天），和结束训练时确认框里的数字一致
export function durationMinutes(session) {
  if (session.cardio && typeof session.cardio.minutes === 'number') return session.cardio.minutes; // 打球 / 有氧按填的时长
  if (!session.finishedAt || !session.startedAt) return null;
  return Math.max(1, Math.round(activeDurationMs(session) / 60000));
}

function totalSets(session) {
  return (session.entries || []).reduce((n, e) => n + (e.sets || []).length, 0);
}

// 训练类型显示名：力量日用模板名，以后的有氧 / 打球用 activityKind
export function sessionTypeName(session, plan) {
  const t = (plan.dayTemplates || []).find((x) => x.id === session.templateId);
  if (t) return t.name;
  const c = (plan.cardioTemplates || []).find((x) => x.id === session.cardioId);
  if (c) return c.name;
  return { cardio: '有氧', ball: '打球', rest: '休息' }[session.activityKind] || session.templateId || '训练';
}

const STATUS_LABEL = { done: '完成', partial: '未做完', skipped: '跳过' };

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

/* ---------- 历史列表 ---------- */

export function renderHistoryList(root, { sessions, plan, loading, error, onRetry, onOpen, onBack }) {
  const finished = sessions.filter((s) => s.finishedAt);
  const items = finished.map((s) => {
    const minutes = durationMinutes(s);
    return el('li', { class: 'hist-row' }, [
      el('button', { class: 'hist-row-btn', type: 'button', onclick: () => onOpen(s.id) }, [
        el('span', { class: 'hist-date', text: fmtDate(s.date) }),
        el('span', { class: 'hist-type', text: sessionTypeName(s, plan) }),
        el('span', { class: 'hist-meta', text: s.cardio ? describeActivity(s, plan).replace(/^[^ ]+ /, '') : `${minutes == null ? '—' : `${minutes} 分钟`} · ${totalSets(s)} 组` }),
      ]),
    ]);
  });
  replaceChildren(root, [
    header('历史', finished.length ? `共 ${finished.length} 次训练` : null, onBack),
    error
      ? el('div', {}, [
          el('p', { class: 'problem', text: `读取历史失败：${error}` }),
          el('button', { class: 'btn-secondary', type: 'button', onclick: onRetry }, '重试'),
        ])
      : finished.length
        ? el('ul', { class: 'hist-list', role: 'list' }, items)
        : el('p', { class: 'muted', text: loading ? '读取中…' : '还没有完成的训练。训练页按"结束训练"之后会出现在这里。' }),
  ]);
}

/* ---------- 单次训练详情 ---------- */

export function renderSessionDetail(root, { session, plan, onOpenExercise, onBack }) {
  const template = (plan.dayTemplates || []).find((t) => t.id === session.templateId) || null;
  const minutes = durationMinutes(session);
  const rows = (session.entries || []).map((entry) => {
    const base = template ? findExercise(template, entry.exerciseId) : null;
    const ex = base ? effectiveExercise(entry, base) : null;
    const name = ex ? ex.name : entry.usedAlternate || entry.exerciseId;
    const bodyweight = Boolean(ex && (ex.load || {}).bodyweight);
    const status = STATUS_LABEL[entry.status] || entry.status;
    const setsText = entry.sets.length ? formatSets(entry.sets, { bodyweight }) : '—';
    return el('li', { class: `hist-ex hist-ex-${entry.status}` }, [
      el('button', { class: 'hist-ex-btn', type: 'button', disabled: !base, onclick: () => onOpenExercise(entry.exerciseId) }, [
        el('span', { class: 'hist-ex-name', text: name }),
        el('span', { class: 'hist-ex-status', text: status }),
        el('span', { class: 'hist-ex-sets', text: setsText }),
        entry.usedAlternate && base ? el('span', { class: 'hist-ex-alt', text: `替代 ${base.name}` }) : null,
      ]),
    ]);
  });
  if (session.cardio) {
    // 打球 / 有氧 / 散步：没有动作，只有一条记录
    replaceChildren(root, [
      header(sessionTypeName(session, plan), fmtDate(session.date), onBack),
      el('section', { class: 'card' }, [el('div', { class: 'row', text: describeActivity(session, plan) })]),
    ]);
    return;
  }
  replaceChildren(root, [
    header(sessionTypeName(session, plan), `${fmtDate(session.date)} · ${minutes == null ? '—' : `${minutes} 分钟`} · ${totalSets(session)} 组`, onBack),
    el('ul', { class: 'hist-list', role: 'list' }, rows),
    el('p', { class: 'muted hist-hint', text: '点动作看它的历史折线' }),
  ]);
}

/* ---------- 动作折线 ---------- */

// 某个动作在每次已完成训练里的数据点（只看原动作口径，即 set.usedAlternate 为空的组），按时间正序
export function exerciseSeries(sessions, exerciseId, { assisted = false } = {}) {
  const points = [];
  let alternateOnly = 0; // 这次只用替代动作做了，不进折线
  for (const s of sessions) {
    if (!s.finishedAt) continue;
    const entry = (s.entries || []).find((e) => e.exerciseId === exerciseId);
    if (!entry || !(entry.sets || []).length) continue;
    const sets = entry.sets.filter((set) => (set.usedAlternate ?? null) === null);
    if (!sets.length) {
      alternateOnly += 1;
      continue;
    }
    const weights = sets.map((set) => set.weight).filter((w) => typeof w === 'number');
    const reps = sets.map((set) => set.reps).filter((r) => typeof r === 'number');
    points.push({
      date: s.date,
      startedAt: s.startedAt,
      // 最佳组：普通动作取最大重量；助力动作助力越小越难，取最小
      bestWeight: weights.length ? (assisted ? Math.min(...weights) : Math.max(...weights)) : null,
      // 有一组没记次数就算未知（旧记录），不画半截的和
      totalReps: reps.length === sets.length ? reps.reduce((a, b) => a + b, 0) : null,
      sets: sets.length,
    });
  }
  points.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  points.alternateOnly = alternateOnly;
  return points;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

// 一条折线：values 里 null 的点跳过。宽度随容器，viewBox 固定 343×150。
export function renderLineChart(values, labels, { unit = '' } = {}) {
  const W = 343;
  const H = 150;
  const padL = 36;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const pts = values.map((v, i) => ({ v, i })).filter((p) => typeof p.v === 'number');
  if (!pts.length) return el('p', { class: 'muted', text: '还没有可画的数据' });
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const n = values.length;
  const x = (i) => (n === 1 ? (padL + W - padR) / 2 : padL + ((W - padL - padR) * i) / (n - 1));
  const y = (v) => padT + ((H - padT - padB) * (hi - v)) / (hi - lo);
  const path = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const children = [
    // 上下两条参考线和刻度
    svgEl('line', { class: 'chart-grid', x1: padL, x2: W - padR, y1: y(hi), y2: y(hi) }),
    svgEl('line', { class: 'chart-grid', x1: padL, x2: W - padR, y1: y(lo), y2: y(lo) }),
    svgEl('text', { class: 'chart-tick', x: padL - 6, y: y(hi) + 4, 'text-anchor': 'end' }, fmt(hi)),
    svgEl('text', { class: 'chart-tick', x: padL - 6, y: y(lo) + 4, 'text-anchor': 'end' }, fmt(lo)),
    svgEl('path', { class: 'chart-line', d: path }),
    ...pts.map((p) => svgEl('circle', { class: 'chart-dot', cx: x(p.i), cy: y(p.v), r: 3.5 })),
    // 首尾日期
    svgEl('text', { class: 'chart-tick', x: x(0), y: H - 6, 'text-anchor': n === 1 ? 'middle' : 'start' }, labels[0]),
    n > 1 ? svgEl('text', { class: 'chart-tick', x: x(n - 1), y: H - 6, 'text-anchor': 'end' }, labels[n - 1]) : null,
    // 最后一个点的值
    (() => {
      const lastPt = pts[pts.length - 1];
      const yv = y(lastPt.v);
      // 最近一次正好是最高点时标签会被顶边裁掉，翻到点下方
      return svgEl('text', { class: 'chart-value', x: Math.min(x(lastPt.i), W - padR - 2), y: yv - 8 < 12 ? yv + 16 : yv - 8, 'text-anchor': 'end' }, `${fmt(lastPt.v)}${unit}`);
    })(),
  ];
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `折线图，${pts.length} 个点，最近 ${fmt(pts[pts.length - 1].v)}${unit}` }, children);
  return svg;
}

export function renderExerciseChart(root, { exerciseId, plan, sessions, loading, onBack }) {
  let base = null;
  for (const t of plan.dayTemplates || []) {
    base = findExercise(t, exerciseId);
    if (base) break;
  }
  const name = base ? base.name : exerciseId;
  const load = base ? base.load || {} : {};
  const assisted = Boolean(load.assisted);
  const bodyweight = Boolean(load.bodyweight);
  const points = exerciseSeries(sessions, exerciseId, { assisted });
  const labels = points.map((p) => fmtShortDate(p.date));
  const weightTitle = assisted ? '最佳组助力（越小越难）' : load.perSideLoad ? '最佳组重量（每边）' : '最佳组重量';
  const bestLabel = assisted ? '最低助力' : load.perSideLoad ? '最佳每边' : '最佳';
  const table = el(
    'ul',
    { class: 'hist-list', role: 'list' },
    [...points].reverse().map((p) =>
      el('li', { class: 'hist-point' }, [
        el('span', { class: 'hist-date', text: fmtDate(p.date) }),
        el('span', { class: 'hist-meta', text: `${bodyweight ? '' : `${bestLabel} ${p.bestWeight == null ? '—' : p.bestWeight} lb · `}共 ${p.totalReps == null ? '—' : p.totalReps} 次 · ${p.sets} 组` }),
      ])
    )
  );
  const altNote = points.alternateOnly ? ` · 另 ${points.alternateOnly} 次只做了替代动作，未计入` : '';
  replaceChildren(root, [
    header(name, loading && !points.length ? '读取中…' : `${points.length} 次训练${base ? ` · 计划 ${formatLoad(base.load)}` : ''}${altNote}`, onBack),
    loading && !points.length
      ? el('p', { class: 'muted', text: '读取中…' })
      : points.length
      ? el('div', {}, [
          !bodyweight
            ? el('section', { class: 'card chart-card' }, [
                el('h2', { class: 'chart-title', text: weightTitle }),
                renderLineChart(points.map((p) => p.bestWeight), labels, { unit: ' lb' }),
              ])
            : null,
          el('section', { class: 'card chart-card' }, [
            el('h2', { class: 'chart-title', text: '总次数' }),
            renderLineChart(points.map((p) => p.totalReps), labels, { unit: ' 次' }),
          ]),
          table,
          el('p', { class: 'muted hist-hint', text: '只统计原动作的记录，替代动作的组不计入折线' }),
        ])
        : el('p', { class: 'muted', text: '这个动作还没有完成的记录' }),
  ]);
}
