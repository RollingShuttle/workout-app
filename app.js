// 训练追踪 PWA — 入口。读取 training-plan.json，首页显示今天的安排。
import { resolveDay, parseDateKey, toDateKey, formatLoad, formatSetsReps, formatCardio } from './schedule.js';

const APP_VERSION = '0.2.0';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

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

function renderHome(root, plan, date, isTest) {
  const day = resolveDay(plan, date);
  const dateText = `${date.getMonth() + 1}月${date.getDate()}日 · ${day.weekdayLabel}`;

  root.replaceChildren(
    el('header', { class: 'today-header' }, [
      el('div', { class: 'today-date' }, [
        el('span', { text: dateText }),
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
    ])
  );
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus('此浏览器不支持离线缓存');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
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

// iOS 主屏幕 App 从后台恢复时不会重新加载页面；跨天了就重画首页。?date= 测试视图固定不变。
function rerenderWhenDayChanges(root, plan, renderedDate) {
  let renderedKey = toDateKey(renderedDate);
  const check = () => {
    if (document.visibilityState !== 'visible') return;
    const now = new Date();
    const key = toDateKey(now);
    if (key === renderedKey) return;
    renderedKey = key;
    renderHome(root, plan, now, false);
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
}

async function main() {
  const root = document.getElementById('app');
  const { date, isTest } = getViewDate();
  try {
    const plan = await loadPlan();
    renderHome(root, plan, date, isTest);
    if (!isTest) rerenderWhenDayChanges(root, plan, date);
  } catch (err) {
    root.replaceChildren(el('p', { class: 'problem', text: `读取训练计划失败：${err.message}` }));
  }
}

setStatus(`v${APP_VERSION}`);
main();
window.addEventListener('load', registerServiceWorker);
