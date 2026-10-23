// 训练追踪 PWA — 入口。首页显示今天的安排；#train 进入训练模式。
import { el } from './dom.js';
import { resolveDay, parseDateKey, toDateKey, formatLoad, formatSetsReps, formatCardio } from './schedule.js';
import { createSession, selectExercise, completeSet, undoLastSet, addExtraSet } from './workout.js';
import { renderTrain, renderTrainUnavailable } from './train-view.js';

const APP_VERSION = '0.3.0';

// 全局状态：计划、当前"今天"、进行中的训练（本步骤只存内存，刷新即丢；草稿保存是下一步）
const state = { plan: null, date: null, isTest: false, session: null };

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

function formatDateText(date, day) {
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${day.weekdayLabel}`;
}

function currentView() {
  return location.hash === '#train' ? 'train' : 'home';
}

function sessionMatches(session, day) {
  return Boolean(session && day.day && session.templateId === day.day.id && session.date === day.dateKey);
}

function sessionHasSets(session) {
  return Boolean(session && session.entries.some((e) => e.sets.length > 0));
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

function renderHome(root, day) {
  const { plan, date, isTest, session } = state;
  const resume = day.kind === 'strength' && sessionMatches(session, day) && sessionHasSets(session);

  root.replaceChildren(
    el('header', { class: 'today-header' }, [
      el('div', { class: 'today-date' }, [
        el('span', { text: formatDateText(date, day) }),
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
    day.kind === 'strength'
      ? el('div', { class: 'home-actions' }, [
          el(
            'button',
            { class: 'btn-primary', type: 'button', onclick: () => { location.hash = '#train'; } },
            resume ? '继续训练' : '开始训练'
          ),
        ])
      : null
  );
}

/* ---------- 训练模式 ---------- */

function goHome() {
  if (sessionHasSets(state.session) && !window.confirm('返回首页？这次训练的记录会保留，再点"继续训练"可以接着练。')) {
    return;
  }
  location.hash = '';
}

function renderTrainView(root, day) {
  if (day.kind !== 'strength') {
    renderTrainUnavailable(root, { title: day.title, onBack: () => { location.hash = ''; } });
    return;
  }
  const template = day.day;
  if (!sessionMatches(state.session, day)) {
    state.session = createSession(template, day.dateKey, Date.now());
  }
  const update = (next) => {
    if (next === state.session) return;
    state.session = next;
    render();
  };
  renderTrain(root, {
    session: state.session,
    template,
    dateText: formatDateText(state.date, day),
    onSelect: (id) => update(selectExercise(state.session, template, id)),
    onCompleteSet: (id) => update(completeSet(state.session, template, id, Date.now())),
    onUndo: (id) => update(undoLastSet(state.session, template, id)),
    onExtra: (id) => update(addExtraSet(state.session, template, id)),
    onBack: goHome,
  });
}

/* ---------- 路由与启动 ---------- */

function render() {
  const root = document.getElementById('app');
  const day = resolveDay(state.plan, state.date);
  if (currentView() === 'train') renderTrainView(root, day);
  else renderHome(root, day);
}

// iOS 主屏幕 App 从后台恢复时不会重新加载页面；跨天了就更新"今天"。
// 训练中已有记录时不换"今天"：render() 按 state.date 重解析训练日，换了会把进行中的
// session 判为不匹配而重建（或显示"不是力量训练日"），已完成的组就丢了。回首页时再补做检查。
// ?date= 测试视图固定不变。
function watchDayChange() {
  let renderedKey = toDateKey(state.date);
  // 把 state.date 换成现在；返回是否换了
  const refreshDate = () => {
    if (currentView() === 'train' && sessionHasSets(state.session)) return false;
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
  render();
  if (!isTest) watchDayChange();
  window.addEventListener('hashchange', render);
}

setStatus(`v${APP_VERSION}`);
main();
window.addEventListener('load', registerServiceWorker);
