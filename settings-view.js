// settings-view.js — 设置页（spec 3.6）。只画 DOM，所有改动通过回调交给 app.js。
import { el, replaceChildren } from './dom.js';

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

export function renderSettings(root, { settings, version, info, isTest, importPreview, saveError, onChange, onExport, onImportFile, onImportApply, onImportCancel, onReloadBuiltin, onClearAll, onBack }) {
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
      info.backupText ? el('p', { class: 'muted settings-note', text: `${info.backupText}。每完成 10 次训练首页会提醒一次` }) : null,
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
      ]),
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
