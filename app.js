// 训练追踪 PWA — 入口。首页显示今天的安排；#train 进入训练模式。
import { el, replaceChildren } from './dom.js';
import {
  resolveDay,
  parseDateKey,
  toDateKey,
  formatLoad,
  formatSetsReps,
  formatCardio,
  WEEKDAY_LABELS,
} from './schedule.js';
import {
  createSession,
  selectExercise,
  completeSet,
  undoLastSet,
  addExtraSet,
  finishSession,
  finishedAtFor,
  summarize,
  resetRest,
  hydrateSession,
  endExercise,
  skipExercise,
  unskipExercise,
  setAlternate,
  findExercise,
  findEntry,
  sessionHasInput,
} from './workout.js';
import { renderTrain, renderTrainUnavailable, renderAlternateSheet, updateRestClock, updateLastRef } from './train-view.js';
import { putSession, deleteSession, findDraft, listSessions, requestPersistentStorage } from './db.js';
import { lastSetsFor, prefillFor } from './history.js';

const APP_VERSION = '0.7.0';
const DRAFT_LOAD_TIMEOUT_MS = 3000; // 启动时等草稿最多这么久，数据库挂住也要先把首页画出来

// 全局状态：计划、当前"今天"、进行中的训练、最近一次保存错误（null = 正常）。
// session 每次变化都写进 IndexedDB（有记录时 put，没记录时 delete），启动时从草稿恢复。
// picker：正在换替代动作的 exerciseId（底部选单打开时），否则 null
// history：已完成的训练（按时间倒序），给"上次数据"用；historyLoaded 为 false 时进训练页会去读一次
// inputs：进行中动作输入框里暂存的值 { exerciseId, setIndex, weight?, reps? }，重画页面时用它恢复
const state = {
  plan: null,
  date: null,
  isTest: false,
  session: null,
  saveError: null,
  trainTemplate: null,
  picker: null,
  history: [],
  historyLoaded: false, // 已发起读取
  historyReady: false, // 已读到结果
  inputs: null,
};

function setStatus(text) {
  const node = document.getElementById('status');
  if (node) node.textContent = text;
}

// 验收用：?date=YYYY-MM-DD 把"今天"换成指定日期；日期无效则忽略。
function getViewDate() {
  const key = new URLSearchParams(location.search).get('date');
  const parsed = key ? parseDateKey(key) : null;
  return { date: parsed || new Date(), isTest: Boolean(parsed) };
}

async function loadPlan() {
  const res = await fetch('./training-plan.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function formatDateText(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAY_LABELS[date.getDay()]}`;
}

function findTemplate(id) {
  return (state.plan.dayTemplates || []).find((t) => t.id === id) || null;
}

function currentView() {
  return location.hash === '#train' ? 'train' : 'home';
}

function sessionMatches(session, day) {
  return Boolean(
    session && !session.finishedAt && day.day && session.templateId === day.day.id && session.date === day.dateKey
  );
}

function sessionHasSets(session) {
  return Boolean(session && session.entries.some((e) => e.sets.length > 0));
}

// 有用户输入（记了组 / 换了替代 / 跳过）、还没结束的训练 = 草稿；不管是不是今天的，都先把它做完或结束
function activeDraft() {
  const s = state.session;
  return s && !s.finishedAt && sessionHasInput(s) ? s : null;
}

function newSession(template, dateKey) {
  const session = createSession(template, dateKey, Date.now());
  if (state.isTest) session.test = true; // ?date= 测试模式建的训练单独标记，不和真实训练混
  return session;
}

// 写入 IndexedDB：有记录就保存，撤到一组都没有就删掉草稿。
// 返回 Promise<boolean>，从不 reject；失败时把错误放进 state.saveError 显示在页面上，成功后清掉。
function persistSession(session) {
  // 有输入、已结束、或输入框里有还没提交的值 → 保存；否则（撤到什么都没有）删掉草稿
  const keep = sessionHasInput(session) || session.finishedAt || session.pendingInput;
  const op = keep ? putSession(session) : deleteSession(session.id);
  return op.then(
    () => {
      if (state.saveError) {
        state.saveError = null;
        render();
      }
      return true;
    },
    (err) => {
      state.saveError = `保存失败：${err.message}`;
      render();
      return false;
    }
  );
}

/* ---------- 首页 ---------- */

function renderExerciseList(template) {
  const items = (template.exercises || []).map((ex) =>
    el('li', { class: 'exercise' }, [
      el('span', { class: 'ex-name', text: ex.name }),
      el('span', { class: 'ex-scheme', text: formatSetsReps(ex) }),
      el('span', { class: 'ex-load', text: formatLoad(ex.load) }),
    ])
  );
  const list = el('ul', { class: 'exercise-list', role: 'list' }, items);
  if (template.cardio) {
    list.appendChild(
      el('li', { class: 'row' }, [
        el('div', { class: 'row-label', text: template.cardio.order || '力量之后' }),
        el('div', { text: `${template.cardio.name} · ${formatCardio(template.cardio)}` }),
      ])
    );
  }
  return list;
}

function renderBody(day, plan) {
  switch (day.kind) {
    case 'strength':
      return renderExerciseList(day.day);
    case 'ballOptional': {
      const ball = (plan.cardioTemplates || []).find((c) => c.id === 'ball');
      return el('div', {}, [
        el('div', { class: 'row' }, [
          el('div', { class: 'row-label', text: '今天打球' }),
          el('div', { text: ball ? ball.name : '羽毛球' }),
          ball && ball.notes ? el('div', { class: 'ex-notes', text: ball.notes }) : null,
        ]),
        el('div', { class: 'row' }, [
          el('div', { class: 'row-label', text: '不打，做二区' }),
          el('div', { text: day.fallback ? formatCardio(day.fallback) : '休息' }),
        ]),
      ]);
    }
    case 'cardio':
      return el('div', { class: 'row' }, [
        el('div', { text: formatCardio(day.cardio) }),
        day.disabledTemplate
          ? el('div', { class: 'ex-notes', text: `${day.disabledTemplate.name} 未启用，今天只做二区` })
          : null,
      ]);
    case 'rest':
      return el('div', { class: 'row' }, [
        el('div', { text: day.ballOptional ? '休息、散步，或打本周第三次球' : '休息、散步' }),
        day.disabledTemplate
          ? el('div', { class: 'ex-notes', text: `${day.disabledTemplate.name} 未启用` })
          : null,
      ]);
    default:
      return el('div', { class: 'row', text: '这一天的安排数据有问题，见下方提示' });
  }
}

function renderDraftCard(draft) {
  const template = findTemplate(draft.templateId);
  const d = parseDateKey(draft.date);
  const totalSets = countSets(draft, template);
  return el('section', { class: 'card draft-card' }, [
    el('div', { class: 'row-label', text: '有未完成的训练' }),
    el('div', { text: `${d ? formatDateText(d) : draft.date} · ${template ? template.name : draft.templateId} · ${totalSets} 组` }),
    el('div', { class: 'ex-notes', text: '先接着练完或结束它，再开始今天的训练' }),
    el('button', { class: 'btn-primary', type: 'button', onclick: () => { location.hash = '#train'; } }, '继续训练'),
    el('button', { class: 'btn-secondary', type: 'button', onclick: () => finishTraining(draft, template) }, '结束并保存'),
  ]);
}

// 总组数：有模板按每侧规则算，没模板就数记录条数
function countSets(session, template) {
  if (template) return summarize(session, template).totalSets;
  return session.entries.reduce((n, e) => n + e.sets.length, 0);
}

function renderHome(root, day) {
  const { plan, date, isTest } = state;
  // 别天的、一组都没有的训练只是进训练页又退出来的空壳，回首页就丢掉
  if (state.session && !state.session.finishedAt && !sessionHasInput(state.session) && !sessionMatches(state.session, day)) {
    state.session = null;
  }
  const draft = activeDraft();
  const draftIsToday = Boolean(draft && sessionMatches(draft, day));
  const resume = draftIsToday;

  replaceChildren(root, [
    state.saveError ? el('p', { class: 'problem save-error', text: state.saveError }) : null,
    el('header', { class: 'today-header' }, [
      el('div', { class: 'today-date' }, [
        el('span', { text: formatDateText(date) }),
        isTest ? el('span', { class: 'tag tag-test', text: '测试日期' }) : null,
        day.source === 'override' ? el('span', { class: 'tag', text: '调课' }) : null,
      ]),
      el('h1', { class: 'today-title', text: day.title }),
      // 调课备注用警告色；每周固定的备注是常态，用普通灰字
      day.note
        ? el('p', { class: day.source === 'override' ? 'today-note' : 'today-note today-note-plain', text: day.note })
        : null,
    ]),
    el('section', { class: 'card' }, [
      renderBody(day, plan),
      ...day.problems.map((p) => el('p', { class: 'problem', text: p })),
    ]),
    draft && !draftIsToday ? renderDraftCard(draft) : null,
    day.kind === 'strength' && !(draft && !draftIsToday)
      ? el('div', { class: 'home-actions' }, [
          el(
            'button',
            { class: 'btn-primary', type: 'button', onclick: () => { location.hash = '#train'; } },
            resume ? '继续训练' : '开始训练'
          ),
        ])
      : null,
  ]);
}

/* ---------- 训练模式 ---------- */

function goHome() {
  if (sessionHasInput(state.session)) {
    const msg = state.saveError
      ? `${state.saveError}。返回首页的话，没保存成功的记录会丢，确定返回？`
      : '返回首页？记录已自动保存，再点"继续训练"可以接着练。';
    if (!window.confirm(msg)) return;
  } else if (state.session && !state.session.finishedAt) {
    // 一组都没记的 session 从没写进库；离开就丢掉，免得同一天再进来沿用一个很早的 startedAt
    state.session = null;
  }
  location.hash = '';
}

// 结束训练：有记录 → 确认后填 finishedAt 并等写入成功再回首页；没记录 → 确认后丢弃。
// template 可能为 null（草稿的模板已从计划里删掉），此时只按记录条数汇总。
async function finishTraining(session, template) {
  if (!session) return;
  const now = Date.now();
  const leave = () => {
    state.session = null;
    state.inputs = null;
    state.historyLoaded = false; // 刚结束的这次要算进"上次"
    state.historyReady = false;
    location.hash = '';
    render(); // 本来就在首页时 hash 没变，不会触发 hashchange，手动画一次
  };
  if (!sessionHasSets(session)) {
    if (!window.confirm('还没有记录任何一组，直接退出训练？')) return;
    await persistSession(session);
    leave();
    return;
  }
  // 隔天才来结束的草稿：按最后一组的时间算结束，用时才不会算成一整天（规则在 workout.js）
  const finishedAt = finishedAtFor(session, now);
  const totalSets = countSets(session, template);
  const minutes = Math.max(1, Math.round((finishedAt - session.startedAt) / 60000));
  if (!window.confirm(`结束训练？共 ${totalSets} 组，用时 ${minutes} 分钟。`)) return;
  const ok = await persistSession(finishSession(session, template, finishedAt));
  if (!ok) {
    window.alert(`${state.saveError || '保存失败'}。这次训练还没保存成功，请再试一次。`);
    return;
  }
  leave();
}

function renderTrainView(root, day) {
  const back = () => { location.hash = ''; };
  const current = state.session && !state.session.finishedAt ? state.session : null;
  let template;
  let dateText;
  if (current && !sessionMatches(current, day)) {
    // 别天的草稿：一直显示它（撤到 0 组也不切换），直到做完或结束
    template = findTemplate(current.templateId);
    if (!template) {
      stopRestTicker();
      state.trainTemplate = null;
      renderTrainUnavailable(root, {
        message: `这条未完成的训练用的模板「${current.templateId}」已经不在计划里，没法继续，可以直接结束保存。`,
        onBack: back,
        onFinish: () => finishTraining(current, null),
      });
      return;
    }
    const d = parseDateKey(current.date);
    dateText = d ? formatDateText(d) : current.date;
  } else {
    if (day.kind !== 'strength') {
      stopRestTicker();
      state.trainTemplate = null;
      renderTrainUnavailable(root, { message: `今天的安排是「${day.title}」，不是力量训练日。`, onBack: back });
      return;
    }
    template = day.day;
    if (!current) {
      state.session = newSession(template, day.dateKey);
    }
    dateText = formatDateText(state.date);
  }
  const update = (next) => {
    if (next === state.session) return;
    state.session = next;
    persistSession(next);
    render();
  };
  state.trainTemplate = template;
  const lastFor = (entry) => lastSetsFor(state.history, entry.exerciseId, entry.usedAlternate, state.session.id);
  if (!state.historyLoaded) {
    state.historyLoaded = true; // 先置位，避免重画时反复读
    listSessions({ test: state.isTest }).then(
      (rows) => {
        state.history = rows;
        state.historyReady = true;
        if (currentView() !== 'train') return;
        // 正在输入框里打字：别整页重画（会收起键盘、丢掉"37."这种没打完的值），只就地更新"上次"那一行
        const focused = document.activeElement;
        if (focused && focused.matches('#app input.num')) {
          updateLastRef(document.getElementById('app'), state.session, state.trainTemplate, lastFor);
          return;
        }
        render();
      },
      () => {
        state.historyLoaded = false;
      }
    );
  }
  // 草稿里带着上次没提交的输入值（页面被 iOS 回收后重载）：恢复成暂存
  if (!state.inputs && state.session.pendingInput) state.inputs = state.session.pendingInput;
  renderTrain(root, {
    session: state.session,
    template,
    dateText,
    now: Date.now(),
    notice: state.saveError,
    prefill: (entry, ex) => prefillFor(entry, ex, lastFor(entry)),
    last: lastFor,
    inputs: state.inputs,
    historyLoaded: state.historyReady,
    onInput: (key, field, value) => {
      const same =
        state.inputs &&
        state.inputs.sessionId === key.sessionId &&
        state.inputs.exerciseId === key.exerciseId &&
        (state.inputs.usedAlternate ?? null) === (key.usedAlternate ?? null) &&
        state.inputs.setIndex === key.setIndex;
      if (!same) state.inputs = { ...key };
      state.inputs[field] = value;
      // 暂存值随草稿写库：页面被 iOS 回收后重载，输入框不会退回预填值。不重画（会丢焦点）
      state.session = { ...state.session, pendingInput: { ...state.inputs } };
      persistSession(state.session);
    },
    onSelect: (id) => update(selectExercise(state.session, template, id)),
    onCompleteSet: (id, values) => {
      state.inputs = null;
      update({ ...completeSet(state.session, template, id, Date.now(), values), pendingInput: null });
    },
    onUndo: (id) => update(undoLastSet(state.session, template, id)),
    onExtra: (id) => update(addExtraSet(state.session, template, id)),
    onBack: goHome,
    onEnd: (id) => update(endExercise(state.session, template, id)),
    onSkip: (id) => update(skipExercise(state.session, template, id)),
    onUnskip: (id) => update(unskipExercise(state.session, template, id)),
    onPickAlternate: (id) => { state.picker = id; render(); },
    onFinish: () => finishTraining(state.session, template),
    onReset: () => update(resetRest(state.session, Date.now())),
  });
  if (state.picker) {
    const entry = findEntry(state.session, state.picker);
    const exercise = findExercise(template, state.picker);
    if (entry && exercise) {
      renderAlternateSheet(root, {
        entry,
        exercise,
        onPick: (name) => {
          state.picker = null;
          const next = setAlternate(state.session, template, entry.exerciseId, name);
          if (next === state.session) {
            render(); // 选的还是当前这个，输入框里的值保留
          } else {
            state.inputs = null; // 换了动作：原动作输入框里暂存的值不带到新动作上，重画后按新动作预填
            update({ ...next, pendingInput: null });
          }
        },
        onClose: () => { state.picker = null; render(); },
      });
    } else {
      state.picker = null;
    }
  }
  startRestTicker();
}

/* ---------- 组间秒表的刷新 ----------
 * 只存时间戳（session.restStartedAt），显示值 = 现在 − 时间戳，不累加。
 * 每次 tick 只改秒表条的文字和颜色，不重画整页；下一次 tick 对齐到下一个整秒，这样数字不会晚跳；
 * 页面不可见时停掉，回到前台立刻重算一次。 */
let restTimer = null;

function tickRest() {
  if (currentView() !== 'train' || !state.session || !state.trainTemplate) return;
  updateRestClock(document.getElementById('app'), state.session, state.trainTemplate, Date.now());
}

function scheduleRestTick() {
  const start = state.session && state.session.restStartedAt;
  const now = Date.now();
  // 对齐到秒表的下一个整秒；没在计时就每秒看一眼
  const delay = start == null ? 1000 : 1000 - ((now - start) % 1000) + 20;
  restTimer = setTimeout(() => {
    restTimer = null;
    tickRest();
    if (document.visibilityState === 'visible' && currentView() === 'train') scheduleRestTick();
  }, delay);
}

function startRestTicker() {
  if (!state.trainTemplate) return; // 提示页没有秒表条，不起定时链
  tickRest();
  if (restTimer || document.visibilityState !== 'visible') return;
  scheduleRestTick();
}

function stopRestTicker() {
  if (!restTimer) return;
  clearTimeout(restTimer);
  restTimer = null;
}

function watchRestVisibility() {
  const onChange = () => {
    if (document.visibilityState === 'visible' && currentView() === 'train') startRestTicker();
    else stopRestTicker();
  };
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('pageshow', onChange);
  window.addEventListener('pagehide', stopRestTicker);
}

/* ---------- 路由与启动 ---------- */

function render() {
  const root = document.getElementById('app');
  const day = resolveDay(state.plan, state.date);
  if (currentView() === 'train') {
    renderTrainView(root, day);
  } else {
    stopRestTicker();
    state.trainTemplate = null;
    state.picker = null; // 选单开着时离开训练页，别让它下次再弹出来
    renderHome(root, day);
  }
}

// iOS 主屏幕 App 从后台恢复时不会重新加载页面；跨天了就更新"今天"。
// 训练中已有记录时不换"今天"：render() 按 state.date 重解析训练日，换了会把进行中的
// session 判为不匹配而重建（或显示"不是力量训练日"），已完成的组就丢了。回首页时再补做检查。
// ?date= 测试视图固定不变。
function watchDayChange() {
  let renderedKey = toDateKey(state.date);
  // 把 state.date 换成现在；返回是否换了
  const refreshDate = () => {
    if (currentView() === 'train' && sessionHasInput(state.session)) return false;
    const now = new Date();
    const key = toDateKey(now);
    if (key === renderedKey) return false;
    renderedKey = key;
    state.date = now;
    return true;
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible' && refreshDate() && currentView() === 'home') render();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  // 必须在 main() 的 hashchange→render 之前注册：回首页时先换日期，再画一次，画的就是新的一天
  window.addEventListener('hashchange', refreshDate);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus('此浏览器不支持离线缓存');
    return;
  }
  try {
    // updateViaCache: 'none'：检查 sw.js 更新时绕过 HTTP 缓存，部署后尽快拿到新版本
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
    setStatus(`v${APP_VERSION} · 已可离线使用`);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          setStatus(`v${APP_VERSION} · 有新版本，重新打开后生效`);
        }
      });
    });
  } catch (err) {
    setStatus(`离线缓存注册失败：${err.message}`);
  }
}

async function main() {
  const root = document.getElementById('app');
  const { date, isTest } = getViewDate();
  state.date = date;
  state.isTest = isTest;
  try {
    state.plan = await loadPlan();
  } catch (err) {
    root.replaceChildren(el('p', { class: 'problem', text: `读取训练计划失败：${err.message}` }));
    return;
  }
  // 读草稿最多等 3 秒：IndexedDB 偶尔会挂住（WebKit 有过 open 不回调的问题），不能让首页跟着卡死。
  // 超时后先画首页，草稿晚到时只要用户还没开始新的训练就补上。
  const draftLoad = findDraft({ test: isTest }).then(
    (draft) => ({ draft }),
    (err) => ({ error: err })
  );
  const first = await Promise.race([
    draftLoad,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), DRAFT_LOAD_TIMEOUT_MS)),
  ]);
  if (first.draft) state.session = hydrateSession(first.draft);
  else if (first.error) state.saveError = `读取草稿失败：${first.error.message}`;
  else if (first.timedOut) {
    draftLoad.then((late) => {
      if (late.draft && !sessionHasSets(state.session)) {
        state.session = hydrateSession(late.draft);
        render();
      } else if (late.error) {
        state.saveError = `读取草稿失败：${late.error.message}`;
        render();
      }
    });
  }
  requestPersistentStorage(); // 申请持久存储，结果不影响使用
  render();
  watchRestVisibility();
  if (!isTest) watchDayChange();
  window.addEventListener('hashchange', render);
}

setStatus(`v${APP_VERSION}`);
main();
window.addEventListener('load', registerServiceWorker);
