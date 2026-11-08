// settings.js — 设置（spec 2.4）：存在 IndexedDB settings 表 key='settings'。缺的字段用默认值补齐。
import { getSetting, putSetting } from './db.js';

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'lb', // lb | kg（只影响显示和输入，数据按 lb 存）
  autoStartRest: true, // 完成一组后自动开始秒表
  defaultRestSeconds: 90, // 动作没写 restSeconds 时的参考休息
  keepScreenAwake: false, // 训练模式下屏幕常亮（耗电，默认关）
  sound: false, // 到参考时长时响一声（默认关）；App 版 = 到点除了震动还响不响铃
  reminderOn: false, // 训练日提醒（只有 App 版能发通知）
  reminderTime: '18:30', // 'HH:MM'
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
    reminderOn: Boolean(r.reminderOn),
    reminderTime: /^\d{2}:\d{2}$/.test(r.reminderTime || '') ? r.reminderTime : DEFAULT_SETTINGS.reminderTime,
  };
}

export async function loadSettings() {
  return normalizeSettings(await getSetting(SETTINGS_KEY));
}

export function saveSettings(settings) {
  return putSetting(SETTINGS_KEY, normalizeSettings(settings));
}
