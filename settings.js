// settings.js — 设置（spec 2.4）：存在 IndexedDB settings 表 key='settings'。缺的字段用默认值补齐。
import { getSetting, putSetting } from './db.js';

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'lb', // lb | kg（只影响显示和输入，数据按 lb 存）
  autoStartRest: true, // 完成一组后自动开始秒表
  defaultRestSeconds: 90, // 动作没写 restSeconds 时的参考休息
  keepScreenAwake: false, // 训练模式下屏幕常亮（耗电，默认关）
  sound: false, // 到参考时长时响一声（默认关）
});

export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rest = Number(r.defaultRestSeconds);
  return {
    unit: r.unit === 'kg' ? 'kg' : 'lb',
    autoStartRest: r.autoStartRest === undefined ? DEFAULT_SETTINGS.autoStartRest : Boolean(r.autoStartRest),
    defaultRestSeconds: Number.isInteger(rest) && rest >= 0 && rest <= 600 ? rest : DEFAULT_SETTINGS.defaultRestSeconds,
    keepScreenAwake: Boolean(r.keepScreenAwake),
    sound: Boolean(r.sound),
  };
}

export async function loadSettings() {
  return normalizeSettings(await getSetting(SETTINGS_KEY));
}

export function saveSettings(settings) {
  return putSetting(SETTINGS_KEY, normalizeSettings(settings));
}
