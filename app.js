// 训练追踪 PWA — 入口（骨架版：只负责注册 Service Worker）
const APP_VERSION = '0.1.0';

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setStatus('此浏览器不支持离线缓存');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    setStatus(`空白骨架 v${APP_VERSION} · 已可离线使用`);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          setStatus(`空白骨架 v${APP_VERSION} · 有新版本，重新打开后生效`);
        }
      });
    });
  } catch (err) {
    setStatus(`离线缓存注册失败：${err.message}`);
  }
}

setStatus(`空白骨架 v${APP_VERSION}`);
window.addEventListener('load', registerServiceWorker);
