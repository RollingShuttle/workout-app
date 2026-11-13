// tab-bar.js — 底部固定栏（用户 2026-11-13 要求）：今天 / 每周计划 / 动作 / 设置。
// 训练页（专心记组，不让人误点走）和首次启动页不显示。图标是写死的 SVG，用 currentColor 跟着主题变色。
import { el, replaceChildren } from './dom.js';

const ICONS = {
  today:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.7" fill="currentColor" stroke="none"/>',
  plan: '<rect x="3.5" y="4" width="17" height="16.5" rx="2.5"/><path d="M3.5 9.5h17M3.5 15h17M9.5 9.5v11"/>',
  exercises: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
};

const TABS = [
  { key: 'today', href: '#', label: '今天' },
  { key: 'plan', href: '#plan', label: '每周计划' },
  { key: 'exercises', href: '#exercises', label: '动作' },
  { key: 'settings', href: '#settings', label: '设置' },
];

// 页面 → 高亮哪个标签；null = 这页不显示固定栏。from：动作详情是从哪一页点进来的（每周计划 / 历史 / 动作页）
export function tabForView(view, from = null) {
  if (view === 'exercise' && from) {
    if (from.startsWith('#plan')) return 'plan';
    if (from.startsWith('#history')) return 'today';
  }
  switch (view) {
    case 'home':
    case 'history': // 历史记录从"今天"进
    case 'session':
      return 'today';
    case 'plan':
    case 'planDay':
      return 'plan';
    case 'exercises':
    case 'exercise':
      return 'exercises';
    case 'settings':
      return 'settings';
    default:
      return null; // 训练页
  }
}

function icon(name) {
  const span = el('span', { class: 'tab-icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

export function renderTabBar(nav, active) {
  if (!nav) return;
  const show = Boolean(active);
  nav.hidden = !show;
  document.body.classList.toggle('has-tabbar', show);
  if (!show) return;
  replaceChildren(
    nav,
    el(
      'div',
      { class: 'tab-bar-inner' },
      TABS.map((t) =>
        el('a', { class: 'tab', href: t.href, 'aria-current': t.key === active ? 'page' : null }, [
          icon(t.key),
          el('span', { class: 'tab-label', text: t.label }),
        ])
      )
    )
  );
}
