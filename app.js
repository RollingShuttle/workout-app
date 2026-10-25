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
  activeDurationMs,
  syncEntries,
} from './workout.js';
import { renderTrain, renderTrainUnavailable, renderAlternateSheet, updateRestClock, updateLastRef, restClockState } from './train-view.js';
import { putSession, deleteSession, findDraft, listSessions, requestPersistentStorage, putSessions, clearSessions, clearSettings, isPersisted, getSetting, putSetting } from './db.js';
import { lastSetsFor, prefillFor } from './history.js';
import { renderHistoryList, renderSessionDetail, renderExerciseChart } from './history-view.js';
import { suggestionFor } from './progression.js';
import { createActivitySession, weekSummary, ballCountThisWeek, BALL_WEEKLY_LIMIT, activitiesOn } from './activity.js';
import { renderActivitySheet, renderWeekStrip, renderTodayActivities } from './activity-view.js';
import { loadStoredPlan, savePlan, blankPlanFrom } from './plan-store.js';
import {
  setWeekday,
  upsertOverride,
  removeOverride,
  setTemplateEnabled,
  updateExercise,
  moveExercise,
  addExercise,
  removeExercise,
  newExerciseId,
  exerciseFromForm,
} from './plan-edit.js';
import { renderPlanOverview, renderPlanDay, renderAssignmentSheet, renderExerciseSheet } from './plan-view.js';
import { loadSettings, saveSettings, normalizeSettings } from './settings.js';
import { setDisplayUnit } from './units.js';
import { setWakeLock, wakeLockSupported, unlockAudio, beep, audioSupported } from './device.js';
import { buildBackup, backupFileName, parseBackup, normalizeBackupMeta, backupReminder, finishedTrainingCount, BACKUP_REMIND_DAYS, BACKUP_SNOOZE_DAYS } from './backup.js';
import { renderSettings } from './settings-view.js';

const APP_VERSION = '0.14.2';
const BACKUP_META_KEY = 'backup';
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
  historyError: null, // 读取失败的原因
  inputs: null,
  chartFrom: null, // 从哪次训练详情点进折线页的，返回时回到它
  activitySheet: null, // 打球 / 有氧 / 散步记录选单打开时的参数
  builtinPlan: null, // training-plan.json 的内容，只作内置模板
  firstRun: false, // 库里还没有计划：显示首次启动页
  planSheet: null, // 计划编辑页打开的表单：{ kind: 'weekday' | 'override' | 'exercise', ... }
  settings: normalizeSettings({}), // spec 2.4；启动时从库里读
  importPreview: null, // 设置页选了备份文件后的预览 { name, data, summary } 或 { name, error }
  persisted: null, // navigator.storage.persisted() 的结果，设置页显示
  backupMeta: normalizeBackupMeta(null), // 上次备份的训练数和时间（settings 表 key=backup）
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

// 路由：#train 训练页；#history 历史列表；#history/<id> 单次详情；#exercise/<id> 动作折线；
// #plan 计划编辑总览；#plan/day/<id> 某个训练日的动作列表；其余首页
function currentView() {
  const h = location.hash;
  if (h === '#train') return 'train';
  if (h === '#history') return 'history';
  if (h.startsWith('#history/')) return 'session';
  if (h.startsWith('#exercise/')) return 'exercise';
  if (h === '#plan') return 'plan';
  if (h.startsWith('#plan/day/')) return 'planDay';
  if (h === '#settings') return 'settings';
  return 'home';
}

function planDayParam() {
  try {
    return decodeURIComponent(location.hash.slice('#plan/day/'.length));
  } catch (_) {
    return null;
  }
}

function routeParam() {
  const i = location.hash.indexOf('/');
  if (i < 0) return null;
  try {
    return decodeURIComponent(location.hash.slice(i + 1));
  } catch (_) {
    return null; // 坏掉的 %xx 当作找不到，不让整个 render 抛错
  }
}

// 历史记录只读一次；读到后正在看的页面需要它就重画。训练页上正在打字时只就地更新"上次"行。
function ensureHistory() {
  if (state.historyLoaded) return;
  state.historyLoaded = true;
  listSessions({ test: state.isTest }).then(
    (rows) => {
      state.history = rows;
      state.historyReady = true;
      const view = currentView();
      if (view === 'train') {
        const focused = document.activeElement;
        if (focused && focused.matches('#app input.num') && state.session && state.trainTemplate) {
          updateLastRef(document.getElementById('app'), state.session, state.trainTemplate, lastFor);
          return;
        }
      }
      render();
    },
    (err) => {
      // 读失败：历史页显示错误和"重试"，训练页退回"没有上次记录"；不自动循环重试
      state.historyError = err && err.message ? err.message : '数据库不可用';
      state.historyReady = true;
      if (currentView() !== 'home') render();
    }
  );
}

function retryHistory() {
  state.historyLoaded = false;
  state.historyReady = false;
  state.historyError = null;
  ensureHistory();
  render();
}

function lastFor(entry) {
  return lastSetsFor(state.history, entry.exerciseId, entry.usedAlternate, state.session ? state.session.id : null);
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

function cardioTemplate(id) {
  return (state.plan.cardioTemplates || []).find((c) => c.id === id) || null;
}

function openActivitySheet(kind, cardioId) {
  const t = cardioTemplate(cardioId);
  const title = kind === 'ball' ? '今天打球' : kind === 'walk' ? '记一条散步' : `记录有氧 · ${t ? t.name : '二区'}`;
  const defaultMinutes = t && typeof t.durationMin === 'number' ? t.durationMin : t && t.durationMin ? t.durationMin.max : kind === 'ball' ? 60 : 30;
  const count = ballCountThisWeek(state.history, state.date);
  const warning = kind === 'ball' && count >= BALL_WEEKLY_LIMIT ? `本周已打 ${count} 次球，规则是最多 ${BALL_WEEKLY_LIMIT} 次（仍可记录）` : null;
  state.activitySheet = { kind, cardioId, title, defaultMinutes, warning };
  render();
}

async function saveActivity(values) {
  const sheet = state.activitySheet;
  if (!sheet) return;
  const session = createActivitySession({ kind: sheet.kind, cardioId: sheet.cardioId, dateKey: toDateKey(state.date), now: Date.now(), ...values });
  if (state.isTest) session.test = true;
  state.activitySheet = null;
  try {
    await putSession(session);
    state.history = [session, ...state.history];
    state.saveError = null;
  } catch (err) {
    state.saveError = `保存失败：${err.message}`;
  }
  render();
}

// 首页按今天的安排给出记录按钮：打球日两个、有氧日一个、休息日散步（可打球的休息日再加打球）
function activityButtons(day) {
  const btn = (label, cls, kind, cardioId) =>
    el('button', { class: cls, type: 'button', onclick: () => openActivitySheet(kind, cardioId) }, label);
  if (day.kind === 'ballOptional') {
    return [btn('今天打球', 'btn-primary', 'ball', 'ball'), day.fallback ? btn('不打，做二区', 'btn-secondary link-btn', 'cardio', day.fallback.id) : null];
  }
  if (day.kind === 'cardio' && day.cardio) return [btn('记录有氧', 'btn-primary', 'cardio', day.cardio.id)];
  if (day.kind === 'rest') {
    return [btn('记一条散步', 'btn-secondary link-btn', 'walk', 'walk'), day.ballOptional ? btn('今天打球', 'btn-secondary link-btn', 'ball', 'ball') : null];
  }
  return [];
}

function renderHome(root, day) {
  const { plan, date, isTest } = state;
  ensureHistory();
  const todayKey = toDateKey(date);
  const summary = weekSummary(state.history, date);
  const ballCount = ballCountThisWeek(state.history, date);
  const todayActs = activitiesOn(state.history, todayKey);
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
    plan.blank ? el('p', { class: 'today-note today-note-plain', text: '现在是空白计划，每天都显示休息。到「计划」里加训练日和每周安排。' }) : null,
    draft && !draftIsToday ? renderDraftCard(draft) : null,
    renderTodayActivities(todayActs, plan),
    state.historyReady && !state.historyError ? renderBackupCard() : null,
    day.kind === 'strength' && !(draft && !draftIsToday)
      ? el('div', { class: 'home-actions' }, [
          el(
            'button',
            { class: 'btn-primary', type: 'button', onclick: () => { location.hash = '#train'; } },
            resume ? '继续训练' : '开始训练'
          ),
        ])
      : null,
    day.kind !== 'strength' ? el('div', { class: 'home-actions home-actions-row' }, activityButtons(day)) : null,
    renderWeekStrip({ summary, todayKey, ballCount, limit: BALL_WEEKLY_LIMIT }),
    renderRules(plan.rules),
    el('div', { class: 'home-links' }, [
      el('a', { class: 'btn-secondary link-btn', href: '#history' }, '历史记录'),
      el('a', { class: 'btn-secondary link-btn', href: '#plan' }, '计划'),
      el('a', { class: 'btn-secondary link-btn', href: '#settings' }, '设置'),
    ]),
  ]);
  if (state.activitySheet) {
    renderActivitySheet(root, {
      ...state.activitySheet,
      onSave: saveActivity,
      onClose: () => { state.activitySheet = null; render(); },
    });
  }
}

// 备份提醒卡：超过 14 天没备份、期间又完成过训练才出现；"稍后再说"推迟 7 天
function renderBackupCard() {
  const r = backupReminder(state.history, state.backupMeta, Date.now());
  if (!r.due) return null;
  const text = state.backupMeta.lastAt
    ? `已经 ${r.days} 天没备份了，期间完成了 ${r.since} 次训练。数据只在这台手机里，导出一份 JSON 更稳妥。`
    : `练了 ${r.days} 天（${r.finished} 次训练），还没备份过。数据只在这台手机里，导出一份 JSON 更稳妥。`;
  return el('section', { class: 'card backup-card' }, [
    el('div', { class: 'row-label', text: '该备份了' }),
    el('div', { text }),
    el('div', { class: 'home-actions home-actions-row' }, [
      el('a', { class: 'btn-primary link-btn', href: '#settings' }, '去导出'),
      el('button', { class: 'btn-secondary link-btn', type: 'button', onclick: dismissBackupReminder }, '稍后再说'),
    ]),
  ]);
}

function saveBackupMeta(meta) {
  state.backupMeta = normalizeBackupMeta(meta);
  putSetting(BACKUP_META_KEY, state.backupMeta).catch((err) => {
    state.saveError = `备份记录没能保存：${err.message}`;
    render();
  });
}

// "稍后再说"：推迟 7 天，不记为已备份
function dismissBackupReminder() {
  saveBackupMeta({ ...state.backupMeta, snoozedUntil: Date.now() + BACKUP_SNOOZE_DAYS * 86400000 });
  render();
}

// 导出成功后调用：提醒消失，设置页显示上次备份时间
function markBackedUp(sessions, now) {
  saveBackupMeta({ lastCount: finishedTrainingCount(sessions), lastAt: now, snoozedUntil: null });
  render();
}

// 规则提示（spec 3.1 底部）：计划里的 rules[] 折叠显示，默认收起；没有规则就不画
function renderRules(rules) {
  const list = (rules || []).filter((r) => typeof r === 'string' && r.trim());
  if (!list.length) return null;
  return el('details', { class: 'rules' }, [
    el('summary', { class: 'rules-summary', text: `排程规则（${list.length} 条）` }),
    el('ul', { class: 'rules-list' }, list.map((r) => el('li', { text: r }))),
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
    state.historyError = null;
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
  const minutes = Math.max(1, Math.round(activeDurationMs(session, finishedAt) / 60000));
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
  // 计划在训练中途被改过：给新加的动作补一条 entry，没有记录的被删动作去掉；有记录的保留（行里会提示找不到）
  const synced = syncEntries(state.session, template);
  if (synced !== state.session) {
    state.session = synced;
    if (sessionHasInput(synced)) persistSession(synced);
  }
  state.trainTemplate = template;
  ensureHistory();
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
    suggest: (entry, ex) =>
      suggestionFor({
        exercise: ex,
        entry,
        templateId: template.id,
        sessions: state.history,
        excludeId: state.session.id,
        increments: ((state.plan.defaults || {}).progression || {}).incrementLb,
      }),
    inputs: state.inputs,
    historyLoaded: state.historyReady,
    defaultRestSeconds: state.settings.defaultRestSeconds,
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
      if (state.settings.sound) unlockAudio(); // 必须在点击手势里解锁音频（spec 3.3）
      state.inputs = null;
      update({ ...completeSet(state.session, template, id, Date.now(), { ...values, autoStartRest: state.settings.autoStartRest }), pendingInput: null });
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

let lastClock = null; // 上一次 tick 的 { start, ready }：从"没到"变"到了"的那一下响一声

function tickRest() {
  if (currentView() !== 'train' || !state.session || !state.trainTemplate) return;
  const now = Date.now();
  const rest = state.settings.defaultRestSeconds;
  updateRestClock(document.getElementById('app'), state.session, state.trainTemplate, now, rest);
  const st = restClockState(state.session, state.trainTemplate, now, rest);
  const start = state.session.restStartedAt;
  if (state.settings.sound && lastClock && lastClock.start === start && !lastClock.ready && st.ready) beep();
  lastClock = { start, ready: st.ready };
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
  lastClock = null; // 回到前台 / 重画时不响：只有看着它走到参考时长才响
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
    syncWakeLock(); // 锁屏时系统会自动放掉常亮，回来再申请
  };
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('pageshow', onChange);
  window.addEventListener('pagehide', stopRestTicker);
}

/* ---------- 路由与启动 ---------- */

function renderHistoryView(root, view) {
  ensureHistory();
  const sessions = state.history;
  const loading = !state.historyReady;
  if (view === 'history') {
    renderHistoryList(root, {
      sessions,
      plan: state.plan,
      loading,
      error: state.historyError,
      onRetry: retryHistory,
      onOpen: (id) => { location.hash = `#history/${encodeURIComponent(id)}`; },
      onBack: () => { location.hash = ''; },
    });
    return;
  }
  if (view === 'session') {
    const id = routeParam();
    const session = sessions.find((x) => x.id === id);
    if (!session) {
      renderTrainUnavailable(root, { message: loading ? '读取中…' : '找不到这次训练的记录。', onBack: () => { location.hash = '#history'; } });
      return;
    }
    state.chartFrom = session.id;
    renderSessionDetail(root, {
      session,
      plan: state.plan,
      onOpenExercise: (exerciseId) => { location.hash = `#exercise/${encodeURIComponent(exerciseId)}`; },
      onBack: () => { location.hash = '#history'; },
    });
    return;
  }
  renderExerciseChart(root, {
    exerciseId: routeParam(),
    plan: state.plan,
    sessions,
    loading,
    onBack: () => { location.hash = state.chartFrom ? `#history/${encodeURIComponent(state.chartFrom)}` : '#history'; },
  });
}

/* ---------- 计划编辑（spec 3.5） ---------- */

// 每次改动：先改内存里的计划并重画（立刻生效），再写库；写失败显示在页面上
function applyPlan(next) {
  state.plan = next;
  state.planSheet = null;
  render();
  savePlan(next).then(
    () => {
      if (state.saveError) {
        state.saveError = null;
        render();
      }
    },
    (err) => {
      state.saveError = `计划没能保存：${err.message}`;
      render();
    }
  );
}

function openPlanSheet(sheet) {
  state.planSheet = sheet;
  render();
}

function closePlanSheet() {
  state.planSheet = null;
  render();
}

const EMPTY_ASSIGN = { type: 'rest', id: null, fallbackId: null, ballOptional: false, note: '' };

function renderPlanView(root, view) {
  const plan = state.plan;
  if (view === 'plan') {
    renderPlanOverview(root, {
      plan,
      saveError: state.saveError,
      onEditWeekday: (weekday, assign) => openPlanSheet({ kind: 'weekday', weekday, assign }),
      onAddOverride: () => openPlanSheet({ kind: 'override', date: toDateKey(state.date), assign: EMPTY_ASSIGN, isNew: true }),
      onEditOverride: (date, assign) => openPlanSheet({ kind: 'override', date, assign, isNew: false }),
      onOpenDay: (id) => { location.hash = `#plan/day/${encodeURIComponent(id)}`; },
      onToggleTemplate: (id, enabled) => applyPlan(setTemplateEnabled(plan, id, enabled)),
      onBack: () => { location.hash = ''; },
    });
    const sheet = state.planSheet;
    if (sheet && sheet.kind === 'weekday') {
      renderAssignmentSheet(root, {
        title: `${WEEKDAY_LABELS[sheet.weekday]} 的安排`,
        plan,
        assign: sheet.assign,
        withDate: false,
        onSave: ({ assign }) => applyPlan(setWeekday(plan, sheet.weekday, assign)),
        onClose: closePlanSheet,
      });
    } else if (sheet && sheet.kind === 'override') {
      renderAssignmentSheet(root, {
        title: sheet.isNew ? '新增调课' : '修改调课',
        plan,
        assign: sheet.assign,
        date: sheet.date,
        withDate: true,
        allowDelete: !sheet.isNew,
        onSave: ({ date, assign }) => {
          // 改了日期 = 原日期那条删掉、新日期那条写入
          const base = !sheet.isNew && date !== sheet.date ? removeOverride(plan, sheet.date) : plan;
          applyPlan(upsertOverride(base, date, assign));
        },
        onDelete: () => applyPlan(removeOverride(plan, sheet.date)),
        onClose: closePlanSheet,
      });
    }
    return;
  }
  // #plan/day/<id>
  const templateId = planDayParam();
  const template = findTemplate(templateId);
  if (!template) {
    renderTrainUnavailable(root, { message: '找不到这个训练日。', onBack: () => { location.hash = '#plan'; } });
    return;
  }
  renderPlanDay(root, {
    template,
    saveError: state.saveError,
    onEditExercise: (exerciseId) => openPlanSheet({ kind: 'exercise', templateId, exerciseId }),
    onAdd: () => openPlanSheet({ kind: 'exercise', templateId, exerciseId: null }),
    onMove: (exerciseId, dir) => applyPlan(moveExercise(plan, templateId, exerciseId, dir)),
    onRemove: (exerciseId) => {
      const ex = findExercise(template, exerciseId);
      if (!window.confirm(`从「${template.name}」里删掉「${ex ? ex.name : exerciseId}」？已保存的记录不受影响。`)) return;
      applyPlan(removeExercise(plan, templateId, exerciseId));
    },
    onBack: () => { location.hash = '#plan'; },
  });
  const sheet = state.planSheet;
  if (sheet && sheet.kind === 'exercise') {
    const existing = sheet.exerciseId ? findExercise(template, sheet.exerciseId) : null;
    renderExerciseSheet(root, {
      title: existing ? `修改 · ${existing.name}` : '新增动作',
      exercise: existing,
      defaultRestSeconds: state.settings.defaultRestSeconds,
      onSave: (form) => {
        const ex = exerciseFromForm(form, existing || {});
        if (existing) applyPlan(updateExercise(plan, templateId, existing.id, ex));
        else applyPlan(addExercise(plan, templateId, { id: newExerciseId(Date.now()), ...ex }));
      },
      onClose: closePlanSheet,
    });
  }
}

/* ---------- 设置（spec 3.6） ---------- */

function applySettings(patch) {
  const next = normalizeSettings({ ...state.settings, ...patch });
  const unitChanged = next.unit !== state.settings.unit;
  state.settings = next;
  setDisplayUnit(next.unit);
  if (unitChanged) {
    // 输入框里暂存的是显示单位的值，换单位后作废（重画后按新单位预填）
    state.inputs = null;
    if (state.session && state.session.pendingInput) {
      state.session = { ...state.session, pendingInput: null };
      persistSession(state.session);
    }
  }
  render();
  saveSettings(next).then(
    () => {
      if (state.saveError) {
        state.saveError = null;
        render();
      }
    },
    (err) => {
      state.saveError = `设置没能保存：${err.message}`;
      render();
    }
  );
}

// 导出：优先走系统分享（iOS 可存到"文件"），不行就下载
async function exportBackup() {
  const now = Date.now();
  let sessions;
  try {
    sessions = await listSessions({ test: state.isTest });
  } catch (err) {
    state.saveError = `读取记录失败：${err.message}`;
    render();
    return;
  }
  const json = JSON.stringify(buildBackup({ plan: state.plan, settings: state.settings, sessions, now }), null, 2);
  const name = backupFileName(now);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      markBackedUp(sessions, now);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户取消
      // 其他失败走下载
    }
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markBackedUp(sessions, now);
}

function previewImport(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseBackup(String(reader.result));
    state.importPreview = parsed.ok ? { name: file.name, data: parsed.data, summary: parsed.summary } : { name: file.name, error: parsed.error };
    render();
  };
  reader.onerror = () => {
    state.importPreview = { name: file.name, error: '读文件失败' };
    render();
  };
  reader.readAsText(file);
}

// mode: 'replace' 覆盖（计划、设置、全部记录）| 'merge' 只加记录（同 id 以文件为准）
async function applyImport(mode) {
  const p = state.importPreview;
  if (!p || p.error) return;
  const { plan, settings, sessions } = p.data;
  const msg =
    mode === 'replace'
      ? `覆盖导入？现在的计划、设置和全部记录会被文件里的替换（${sessions.length} 条记录）。`
      : `合并导入？加入 ${sessions.length} 条记录，同一条以文件为准；计划和设置不变。`;
  if (!window.confirm(msg)) return;
  try {
    if (mode === 'replace') {
      await clearSessions();
      await putSessions(sessions);
      if (plan) {
        await savePlan(plan);
        state.plan = plan;
      }
      if (settings) {
        await saveSettings(settings);
        state.settings = settings;
        setDisplayUnit(settings.unit);
      }
    } else {
      await putSessions(sessions);
    }
    state.saveError = null;
  } catch (err) {
    state.saveError = `导入失败：${err.message}`;
  }
  state.importPreview = null;
  // 记录变了：草稿重找、历史重读
  state.session = null;
  state.inputs = null;
  state.historyLoaded = false;
  state.historyReady = false;
  state.historyError = null;
  try {
    const draft = await findDraft({ test: state.isTest });
    state.session = draft ? hydrateSession(draft) : null;
  } catch (_) {
    /* 读不到草稿就当没有 */
  }
  render();
}

async function reloadBuiltinPlan() {
  if (!window.confirm('用内置计划覆盖现在的计划？在计划编辑里改过的内容会丢，已保存的记录不受影响。')) return;
  try {
    await savePlan(state.builtinPlan);
    state.plan = state.builtinPlan;
    state.saveError = null;
  } catch (err) {
    state.saveError = `计划没能保存：${err.message}`;
  }
  render();
}

// 清空数据（二次确认）：记录、计划、设置全删，回到首次启动页
async function clearAllData() {
  if (!window.confirm('清空全部数据？训练计划、设置和所有记录都会删除，不可恢复。建议先导出备份。')) return;
  if (!window.confirm('最后确认：真的要清空吗？')) return;
  try {
    await clearSessions();
    await clearSettings();
  } catch (err) {
    state.saveError = `清空失败：${err.message}`;
    render();
    return;
  }
  state.session = null;
  state.inputs = null;
  state.history = [];
  state.historyLoaded = false;
  state.historyReady = false;
  state.historyError = null;
  state.importPreview = null;
  state.saveError = null;
  state.settings = normalizeSettings({});
  setDisplayUnit(state.settings.unit);
  state.backupMeta = normalizeBackupMeta(null);
  state.plan = state.builtinPlan;
  state.firstRun = true;
  location.hash = '';
  render();
}

function backupStatusText() {
  if (!state.historyReady || state.historyError) return null;
  const r = backupReminder(state.history, state.backupMeta, Date.now());
  const base = state.backupMeta.lastAt
    ? `上次备份：${formatDateText(new Date(state.backupMeta.lastAt))}（${r.days} 天前）· 之后完成 ${r.since} 次训练`
    : `还没备份过 · 已完成 ${r.finished} 次训练`;
  return `${base}。超过 ${BACKUP_REMIND_DAYS} 天没备份且有新训练时首页会提醒${r.snoozed ? '（已推迟）' : ''}`;
}

function renderSettingsView(root) {
  ensureHistory();
  renderSettings(root, {
    settings: state.settings,
    version: APP_VERSION,
    isTest: state.isTest,
    info: {
      sessionCount: state.historyReady && !state.historyError ? state.history.length : null,
      persisted: state.persisted,
      backupText: backupStatusText(),
      wakeLockSupported: wakeLockSupported(),
      audioSupported: audioSupported(),
    },
    importPreview: state.importPreview,
    saveError: state.saveError,
    onChange: applySettings,
    onExport: exportBackup,
    onImportFile: previewImport,
    onImportApply: applyImport,
    onImportCancel: () => {
      state.importPreview = null;
      render();
    },
    onReloadBuiltin: reloadBuiltinPlan,
    onClearAll: clearAllData,
    onBack: () => {
      location.hash = '';
    },
  });
}

// 屏幕常亮：只在训练页、设置开着、页面可见时持有；离开训练页或切后台就放掉
function syncWakeLock() {
  const want = state.settings.keepScreenAwake && currentView() === 'train' && Boolean(state.trainTemplate) && document.visibilityState === 'visible';
  setWakeLock(want);
}

// 首次启动：选"载入内置计划"或"从空白计划开始"，选了就写库
async function choosePlan(plan) {
  try {
    await savePlan(plan);
    state.saveError = null;
  } catch (err) {
    state.saveError = `计划没能保存：${err.message}`;
  }
  state.plan = plan;
  state.firstRun = false;
  render();
}

function renderFirstRun(root) {
  replaceChildren(root, [
    el('header', { class: 'today-header' }, [el('h1', { class: 'today-title', text: '第一次打开' })]),
    el('section', { class: 'card firstrun' }, [
      el('p', { text: '先选一份训练计划。所有数据只存在这台手机里，没有账号、不上传。' }),
      el('button', { class: 'btn-primary', type: 'button', onclick: () => choosePlan(state.builtinPlan) }, '载入内置计划'),
      el('p', { class: 'ex-notes', text: '内置计划：推日 / 拉日 / 腿日 / 上肢B，周二周五可选打球，含过渡周调课。' }),
      el('button', { class: 'btn-secondary link-btn', type: 'button', onclick: () => choosePlan(blankPlanFrom(state.builtinPlan)) }, '从空白计划开始'),
      el('p', { class: 'ex-notes', text: '空白计划：每天休息，只能记打球 / 散步 / 二区，训练日以后在计划编辑里加。' }),
    ]),
    state.saveError ? el('p', { class: 'problem save-error', text: state.saveError }) : null,
  ]);
}

function render() {
  renderView();
  syncWakeLock();
}

function renderView() {
  const root = document.getElementById('app');
  if (state.firstRun) {
    stopRestTicker();
    renderFirstRun(root);
    return;
  }
  const day = resolveDay(state.plan, state.date);
  const view = currentView();
  if (view === 'train') {
    renderTrainView(root, day);
    return;
  }
  stopRestTicker();
  state.trainTemplate = null;
  state.picker = null; // 选单开着时离开训练页，别让它下次再弹出来
  if (view !== 'home') state.activitySheet = null;
  if (view !== 'plan' && view !== 'planDay') state.planSheet = null;
  if (view !== 'settings') state.importPreview = null;
  if (view === 'home') renderHome(root, day);
  else if (view === 'plan' || view === 'planDay') renderPlanView(root, view);
  else if (view === 'settings') renderSettingsView(root);
  else renderHistoryView(root, view);
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
    state.builtinPlan = await loadPlan();
  } catch (err) {
    root.replaceChildren(el('p', { class: 'problem', text: `读取内置训练计划失败：${err.message}` }));
    return;
  }
  // 设置和计划一起读；设置读失败或超时就用默认值
  const settingsLoad = loadSettings().then(
    (settings) => ({ settings }),
    (err) => ({ error: err })
  );
  // 运行时的计划在 IndexedDB 里；没有就进首次启动页让用户选。读库最多等 3 秒，挂住就先用内置计划。
  const storedLoad = loadStoredPlan().then(
    (plan) => ({ plan }),
    (err) => ({ error: err })
  );
  const storedFirst = await Promise.race([
    storedLoad,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), DRAFT_LOAD_TIMEOUT_MS)),
  ]);
  if (storedFirst.plan) {
    state.plan = storedFirst.plan;
  } else if (storedFirst.error || storedFirst.timedOut) {
    state.plan = state.builtinPlan;
    state.saveError = `读取计划失败：${storedFirst.error ? storedFirst.error.message : '数据库没有响应'}，暂时用内置计划`;
  } else {
    state.plan = state.builtinPlan;
    state.firstRun = true;
  }
  const metaLoad = getSetting(BACKUP_META_KEY).then(
    (v) => ({ meta: normalizeBackupMeta(v) }),
    () => ({ meta: null })
  );
  const settingsFirst = await Promise.race([
    settingsLoad,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), DRAFT_LOAD_TIMEOUT_MS)),
  ]);
  if (settingsFirst.settings) state.settings = settingsFirst.settings;
  const metaFirst = await Promise.race([metaLoad, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), DRAFT_LOAD_TIMEOUT_MS))]);
  if (metaFirst.meta) state.backupMeta = metaFirst.meta;
  setDisplayUnit(state.settings.unit);
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
  requestPersistentStorage() // 申请持久存储，结果不影响使用；设置页显示是否批准
    .then(() => isPersisted())
    .then((v) => {
      state.persisted = v;
      if (currentView() === 'settings') render();
    });
  render();
  watchRestVisibility();
  if (!isTest) watchDayChange();
  window.addEventListener('hashchange', render);
}

setStatus(`v${APP_VERSION}`);
main();
window.addEventListener('load', registerServiceWorker);
