// native.js — 网页和 iOS 原生壳（WKWebView）之间的桥。协议见 docs/ios-app-plan.md 3.4。
// PWA 里没有原生时，所有调用都是空操作（返回 false），app.js 不用区分两种环境。
// 原生每次重新取 handler，不在加载时定死：测试时可以后注入假的 window.webkit。

function handler() {
  try {
    const w = window.webkit;
    return w && w.messageHandlers && w.messageHandlers.native ? w.messageHandlers.native : null;
  } catch (_) {
    return null;
  }
}

const commandHandlers = [];
const eventHandlers = [];

export const native = {
  caps: new Set(),
  version: null,
  get available() {
    return Boolean(handler());
  },
  send(msg) {
    const h = handler();
    if (!h) return false;
    try {
      h.postMessage(msg);
      return true;
    } catch (_) {
      return false;
    }
  },
  // 组间休息到点的本地通知：at = 到点的时间戳（毫秒）；重复 set 覆盖上一条
  restTimer: {
    set(at, title, body, sound) {
      return native.send({ type: 'restTimer.set', at, title, body, sound: Boolean(sound) });
    },
    clear() {
      return native.send({ type: 'restTimer.clear' });
    },
  },
  // 训练日提醒：items = [{ id, date: 'YYYY-MM-DD', hour, minute, title, body }]
  reminders: {
    set(items) {
      return native.send({ type: 'reminders.set', items });
    },
    clear() {
      return native.send({ type: 'reminders.clear' });
    },
  },
  keepAwake(on) {
    return native.send({ type: 'keepAwake', on: Boolean(on) });
  },
  haptic(kind) {
    return native.send({ type: 'haptic', kind });
  },
  // 返回 true 表示原生接管了（弹分享面板 / 文件选择器），网页不再走自己的路
  exportFile(name, json) {
    return native.send({ type: 'export', name, json });
  },
  importFile() {
    return native.send({ type: 'import' });
  },
  state(s) {
    return native.send({ type: 'state', ...s });
  },
  ready() {
    return native.send({ type: 'ready' });
  },
  // 原生发来的命令：fn(name, detail)，name = completeSet | resetRest | startTraining | nextExercise
  onCommand(fn) {
    commandHandlers.push(fn);
  },
  // 其他事件：fn(detail)，detail.type = hello | import.result | foreground | notification.permission
  onEvent(fn) {
    eventHandlers.push(fn);
  },
};

// 原生 → 网页的入口：Swift 调 evaluateJavaScript("window.nativeEvent({...})")
window.nativeEvent = (detail) => {
  if (!detail || typeof detail !== 'object') return;
  if (detail.type === 'hello') {
    native.version = detail.version || null;
    native.caps = new Set(Array.isArray(detail.caps) ? detail.caps : []);
  }
  if (detail.type === 'command') {
    for (const fn of commandHandlers) fn(detail.name, detail);
  }
  for (const fn of eventHandlers) fn(detail);
};
