// dom.js — 极简 DOM 构造工具。attrs 里 class / text 特殊处理，on* 是事件，true 表示布尔属性。
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// root.replaceChildren(null) 会把 null 变成字面量文本，这里统一过滤
export function replaceChildren(root, children) {
  root.replaceChildren(...[].concat(children).filter((c) => c != null && c !== false));
}
