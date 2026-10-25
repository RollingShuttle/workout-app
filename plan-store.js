// plan-store.js — 训练计划存在 IndexedDB（settings 表 key='plan'）。
// training-plan.json 只是"内置计划"模板：首次启动时可以载入它，之后运行时一律读库里的那份。
import { getSetting, putSetting } from './db.js';

export const PLAN_KEY = 'plan';

export function loadStoredPlan() {
  return getSetting(PLAN_KEY);
}

export function savePlan(plan) {
  return putSetting(PLAN_KEY, { ...plan, storedAt: Date.now() });
}

// 空白计划：没有训练日，每天休息；保留有氧 / 打球 / 散步模板和默认值，这样记录功能还能用
export function blankPlanFrom(builtin) {
  return {
    version: builtin.version || 1,
    owner: '',
    units: builtin.units || { weight: 'lb' },
    defaults: builtin.defaults || {},
    dayTemplates: [],
    cardioTemplates: builtin.cardioTemplates || [],
    weeklySchedule: [1, 2, 3, 4, 5, 6, 0].map((weekday, i) => ({
      weekday,
      label: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
      primary: { type: 'rest' },
    })),
    rules: [],
    overrides: [],
    blank: true,
  };
}
