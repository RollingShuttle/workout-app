// units.js — 重量单位（spec 2.4 unit）。所有数据一律按 lb 存；这里只管显示和输入框里的换算。
// 显示单位是全局的（设置页改一次，到处生效），所以放在模块里，app.js 启动和改设置时调 setDisplayUnit。
const LB_PER_KG = 2.2046226218;
let unit = 'lb';

export function setDisplayUnit(u) {
  unit = u === 'kg' ? 'kg' : 'lb';
}

export function displayUnit() {
  return unit;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// lb → 当前显示单位的数值（kg 保留一位小数）；null / 非数字原样返回
export function lbToDisplay(lb) {
  if (lb == null || typeof lb !== 'number' || !Number.isFinite(lb)) return lb;
  return unit === 'kg' ? round1(lb / LB_PER_KG) : lb;
}

// 输入框里的数值（当前显示单位）→ lb（kg 来源保留一位小数）
export function displayToLb(v) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return v;
  return unit === 'kg' ? round1(v * LB_PER_KG) : v;
}

export function formatWeight(lb, { withUnit = true } = {}) {
  if (lb == null) return '—';
  const n = lbToDisplay(lb);
  return withUnit ? `${n} ${unit}` : String(n);
}

// 重量输入框的 ± 步进和最小刻度
export function weightStep() {
  return unit === 'kg' ? { delta: 2.5, step: 0.5 } : { delta: 5, step: 0.5 };
}

// 另一个单位的写法（历史里磅数旁边带公斤，反之亦然）："47.6 kg" / "105 lb"
export function otherUnitText(lb) {
  if (lb == null || typeof lb !== 'number' || !Number.isFinite(lb)) return '';
  return unit === 'kg' ? `${lb} lb` : `${round1(lb / LB_PER_KG)} kg`;
}

export function formatWeightDual(lb) {
  if (lb == null) return '—';
  return `${formatWeight(lb)}（${otherUnitText(lb)}）`;
}
