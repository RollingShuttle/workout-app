// settings-view.js — 设置页（spec 3.6）。只画 DOM，所有改动通过回调交给 app.js。
import { el, replaceChildren } from './dom.js';
import { KIND_LABELS } from './hk-import.js';

function fmtStart(ms) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// Apple Health 导入的预览卡：每条可改"记为"，确认后才入库
function hkCard(hkPreview, { onHkChoice, onHkImport, onHkCancel }) {
  if (!hkPreview) return null;
  if (hkPreview.done != null) {
    return el('section', { class: 'card import-card' }, [
      el('div', { class: 'row-label', text: `文件：${hkPreview.name}` }),
      el('p', { text: `已导入 ${hkPreview.done} 条，首页和历史里能看到。` }),
      btn('关闭', onHkCancel),
    ]);
  }
  const items = hkPreview.items || [];
  const n = items.filter((it) => it.choice !== 'skip').length;
  return el('section', { class: 'card import-card' }, [
    el('div', { class: 'row-label', text: `文件：${hkPreview.name}` }),
    hkPreview.error ? el('p', { class: 'problem', text: hkPreview.error }) : el('p', { text: `${items.length} 条体能训练，将导入 ${n} 条。每条可以改"记为"。` }),
    items.length
      ? el(
          'ul',
          { class: 'hk-list', role: 'list' },
          items.map((it, i) =>
            el('li', { class: 'hk-row' }, [
              el('div', { class: 'hk-main' }, [
                el('div', { class: 'hk-title', text: `${fmtStart(it.start)} · ${it.type} · ${it.minutes} 分钟${it.avgHr != null ? ` · 心率 ${it.avgHr}` : ''}` }),
                it.note ? el('div', { class: 'muted hk-note', text: it.note }) : null,
              ]),
              el(
                'select',
                { class: 'sheet-select hk-select', 'aria-label': `${it.type} 记为`, onchange: (e) => onHkChoice(i, e.target.value) },
                Object.keys(KIND_LABELS).map((k) => el('option', { value: k, selected: it.choice === k }, KIND_LABELS[k]))
              ),
            ])
          )
        )
      : null,
    !hkPreview.error ? btn(n ? `导入 ${n} 条` : '没有要导入的', onHkImport, 'btn-primary') : null,
    btn('取消', onHkCancel),
  ]);
}

function header(title, sub, onBack) {
  return el('header', { class: 'train-header' }, [
    el('div', { class: 'train-topline' }, [
      el('button', { class: 'btn-back', type: 'button', onclick: onBack }, '‹ 返回'),
      el('div', { class: 'train-title' }, [
        el('h1', { class: 'train-name', text: title }),
        sub ? el('div', { class: 'train-sub', text: sub }) : null,
      ]),
    ]),
  ]);
}

function section(title, children) {
  return el('section', { class: 'plan-section' }, [el('h2', { class: 'plan-section-title', text: title }), ...[].concat(children)]);
}

function btn(label, onclick, cls = 'btn-secondary') {
  return el('button', { class: cls, type: 'button', onclick }, label);
}

function toggleRow(id, label, checked, onChange, { disabled = false, note } = {}) {
  return el('div', { class: 'settings-row' }, [
    el('label', { class: 'plan-check', for: id }, [
      el('input', { type: 'checkbox', id, checked, disabled, onchange: (e) => onChange(e.target.checked) }),
      el('span', { text: label }),
    ]),
    note ? el('p', { class: 'muted settings-note', text: note }) : null,
  ]);
}

export function renderSettings(root, { settings, version, info, isTest, importPreview, hkPreview, saveError, onChange, onExport, onImportFile, onImportApply, onImportCancel, onHkFile, onHkChoice, onHkImport, onHkCancel, onReloadBuiltin, onClearAll, onBack }) {
  const unitBtn = (u) =>
    el('button', { class: `seg-btn${settings.unit === u ? ' seg-btn-on' : ''}`, type: 'button', 'aria-pressed': settings.unit === u ? 'true' : 'false', onclick: () => onChange({ unit: u }) }, u);
  const persistedText = info.persisted === true ? '已获持久存储' : info.persisted === false ? '未获持久存储（系统空间紧张时可能被清）' : '持久存储：此浏览器不支持';
  const countText = info.sessionCount == null ? '记录读取中…' : `${info.sessionCount} 条记录`;
  const s = importPreview && importPreview.summary;

  replaceChildren(root, [
    header('设置', `v${version} · 数据只存在这台手机里`, onBack),
    saveError ? el('p', { class: 'problem save-error', text: saveError }) : null,
    section('训练', [
      el('div', { class: 'settings-row settings-row-inline' }, [
        el('span', { class: 'settings-label', text: '重量单位' }),
        el('div', { class: 'seg', role: 'group', 'aria-label': '重量单位' }, [unitBtn('lb'), unitBtn('kg')]),
      ]),
      el('p', { class: 'muted settings-note', text: '数据一律按 lb 存，kg 只是换算显示和输入' }),
      toggleRow('set-auto-rest', '完成一组后自动开始秒表', settings.autoStartRest, (v) => onChange({ autoStartRest: v }), {
        note: settings.autoStartRest ? null : '关掉后做完一组要按秒表旁的「开始计时」',
      }),
      el('div', { class: 'settings-row settings-row-inline' }, [
        el('label', { class: 'settings-label', for: 'set-rest', text: '默认参考休息秒数' }),
        el('input', {
          class: 'num settings-num',
          id: 'set-rest',
          type: 'number',
          inputmode: 'numeric',
          step: '5',
          min: '0',
          max: '600',
          value: String(settings.defaultRestSeconds),
          onchange: (e) => {
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 0 && n <= 600) onChange({ defaultRestSeconds: n });
            else e.target.value = String(settings.defaultRestSeconds);
          },
        }),
      ]),
      el('p', { class: 'muted settings-note', text: '动作没写休息秒数时用这个（0–600）' }),
      toggleRow('set-sound', '到参考休息时长时响一声', settings.sound, (v) => onChange({ sound: v }), {
        disabled: !info.audioSupported,
        note: info.audioSupported ? '只在 App 打开着的时候响；静音键打开时可能无声' : '此浏览器不支持',
      }),
      toggleRow('set-awake', '训练时屏幕常亮', settings.keepScreenAwake, (v) => onChange({ keepScreenAwake: v }), {
        disabled: !info.wakeLockSupported,
        note: info.wakeLockSupported ? '只在训练页生效；常亮一小时会明显耗电。秒表按时间戳算，锁屏不影响准确' : '此浏览器不支持屏幕常亮',
      }),
    ]),
    section('数据', [
      el('p', { class: 'settings-stat', text: `${countText} · ${persistedText}` }),
      info.backupText ? el('p', { class: 'muted settings-note', text: info.backupText }) : null,
      el('div', { class: 'settings-actions' }, [
        btn('导出 JSON 备份', onExport, 'btn-primary'),
        el('input', {
          type: 'file',
          accept: 'application/json,.json',
          class: 'settings-file',
          id: 'set-import',
          'aria-label': '选择备份文件',
          onchange: (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) onImportFile(f);
            e.target.value = '';
          },
        }),
        btn('导入 JSON 备份', () => root.querySelector('#set-import').click()),
        el('input', {
          type: 'file',
          accept: '.txt,.json,text/plain,application/json',
          class: 'settings-file',
          id: 'set-hk',
          'aria-label': '选择快捷指令导出的运动记录文件',
          onchange: (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) onHkFile(f);
            e.target.value = '';
          },
        }),
        btn('导入 Apple Health 运动记录', () => root.querySelector('#set-hk').click()),
      ]),
      el('p', { class: 'muted settings-note', text: 'Apple Health 的打球 / 二区 / 散步：先在手机上用快捷指令导出"运动记录.txt"（搭建步骤见仓库 docs/shortcut-apple-health.md），再在这里选它。已导入过的会自动跳过。' }),
      hkCard(hkPreview, { onHkChoice, onHkImport, onHkCancel }),
      importPreview
        ? el('section', { class: 'card import-card' }, [
            el('div', { class: 'row-label', text: `文件：${importPreview.name}` }),
            importPreview.error
              ? el('p', { class: 'problem', text: importPreview.error })
              : el('p', { text: `${s.sessions} 条记录（${s.finished} 次已完成）${s.plan ? ' · 含计划' : ''}${s.settings ? ' · 含设置' : ''}` }),
            !importPreview.error ? btn('覆盖：替换现在的计划、设置和全部记录', () => onImportApply('replace'), 'btn-secondary plan-delete') : null,
            !importPreview.error ? btn('合并：只加入记录，同一条以文件为准', () => onImportApply('merge')) : null,
            btn('取消', onImportCancel),
          ])
        : null,
      el('p', { class: 'muted settings-note', text: '会丢数据的情况：从主屏幕删除这个 App、在 Safari 设置里「清除历史记录与网站数据」、换手机。换手机前先导出，新手机上导入。' }),
      isTest ? el('p', { class: 'muted settings-note', text: '现在是 ?date= 测试模式：导出只含测试记录；覆盖导入和清空会动全部数据。' }) : null,
    ]),
    section('计划', [
      el('div', { class: 'settings-actions' }, [
        el('a', { class: 'btn-secondary link-btn', href: '#plan' }, '编辑计划（训练日、每周安排、启用上肢B）'),
        btn('重新载入内置计划（覆盖现在的计划）', onReloadBuiltin),
      ]),
    ]),
    section('危险操作', [
      el('div', { class: 'settings-actions' }, [btn('清空全部数据', onClearAll, 'btn-secondary plan-delete')]),
      el('p', { class: 'muted settings-note', text: '会问两次。计划、设置、所有记录都删掉，回到「第一次打开」页。' }),
    ]),
  ]);
}
