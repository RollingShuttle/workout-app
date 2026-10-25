// device.js — 屏幕常亮（Screen Wake Lock）和提示音（WebAudio）。都是尽力而为：不支持或失败就安静跳过。
// 不做通知、不做震动（CLAUDE.md）；声音只在 App 在前台、秒表走到参考时长那一刻响一下。

let sentinel = null;
let wanted = false;

export function wakeLockSupported() {
  return Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === 'function');
}

// on=true 时申请（页面必须可见），false 时释放。返回现在是否持有。
export async function setWakeLock(on) {
  wanted = on;
  if (!wakeLockSupported()) return false;
  if (!on) {
    if (sentinel) {
      const s = sentinel;
      sentinel = null;
      try {
        await s.release();
      } catch (_) {
        /* 已释放 */
      }
    }
    return false;
  }
  if (sentinel) return true;
  if (document.visibilityState !== 'visible') return false;
  try {
    const s = await navigator.wakeLock.request('screen');
    // 等待期间又关掉了，或并发的另一次申请已经拿到：放掉这一个，别同时持有两份
    if (!wanted || sentinel) {
      s.release();
      return Boolean(sentinel);
    }
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null; // 锁屏 / 切后台时系统会自动释放，回来再申请
    });
    return true;
  } catch (_) {
    return false;
  }
}

export function wakeLockActive() {
  return Boolean(sentinel);
}

let ctx = null;

export function audioSupported() {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

// 必须在用户手势里调（点"完成一组"时），iOS 才允许之后出声（spec 3.3）
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  } catch (_) {
    return false;
  }
}

export function audioUnlocked() {
  return Boolean(ctx);
}

// 两声短促的 880Hz；没解锁过就不响
export function beep() {
  if (!ctx) return false;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    for (const off of [0, 0.18]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + off);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + off + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + off);
      osc.stop(t0 + off + 0.14);
    }
    return true;
  } catch (_) {
    return false;
  }
}
