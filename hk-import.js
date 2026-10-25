// hk-import.js — 导入 Apple Health 的体能训练（由 iOS 快捷指令导出的文本文件）。纯函数，不碰数据库。
// 文件格式（快捷指令每次训练写一行，| 分隔）：
//   类型|开始时间(ISO 8601)|结束时间(ISO 8601)|平均心率(可空)
//   羽毛球|2026-10-24T19:00:00+08:00|2026-10-24T20:05:00+08:00|135
// 也接受 JSON 数组：[{ "type": "羽毛球", "start": "...", "end": "...", "avgHr": 135 }]
// 搭建快捷指令的步骤见 docs/shortcut-apple-health.md
import { toDateKey } from './schedule.js';

export const HK_SOURCE = 'health';

// 羽毛球 → 打球；步行类 → 按心率猜二区 / 散步；骑行、椭圆机等机器 → 二区
// 中英文系统的叫法都认（英文系统的快捷指令给的是 Badminton / Walking / Outdoor Walk / Cycling / Elliptical …）
const BALL_TYPES = ['羽毛球', 'badminton'];
const WALK_TYPES = ['步行', '徒步', '健走', 'walk', 'hiking', 'hike'];
const MACHINE_TYPES = ['骑行', '椭圆机', '划船机', '楼梯机', '踏步机', 'cycl', 'bike', 'biking', 'elliptical', 'rowing', 'rower', 'stair', 'stepper'];

function parseLine(line, lineNo) {
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 3) return { error: `第 ${lineNo} 行格式不对（要 类型|开始|结束|心率）` };
  return buildItem({ type: parts[0], start: parts[1], end: parts[2], avgHr: parts[3] }, lineNo);
}

function buildItem(raw, where) {
  const type = String(raw.type || '').trim();
  const start = Date.parse(raw.start);
  const end = Date.parse(raw.end);
  if (!type) return { error: `第 ${where} 条缺类型` };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: `第 ${where} 条的时间读不出来：${raw.start} / ${raw.end}` };
  if (end <= start) return { error: `第 ${where} 条结束时间早于开始时间` };
  const hr = raw.avgHr === '' || raw.avgHr == null ? null : Number(raw.avgHr);
  const minutes = Math.max(1, Math.round((end - start) / 60000));
  return {
    item: {
      type,
      start,
      end,
      minutes,
      avgHr: Number.isFinite(hr) && hr > 0 ? Math.round(hr) : null,
      dateKey: toDateKey(new Date(start)),
      importKey: `hk:${new Date(start).toISOString()}`,
    },
  };
}

// 返回 { ok: true, items: [...] } 或 { ok: false, error }
export function parseWorkoutsFile(text) {
  const src = String(text || '').replace(/^﻿/, '').trim();
  if (!src) return { ok: false, error: '文件是空的' };
  const items = [];
  if (src.startsWith('[')) {
    let arr;
    try {
      arr = JSON.parse(src);
    } catch (_) {
      return { ok: false, error: '不是合法的 JSON' };
    }
    if (!Array.isArray(arr)) return { ok: false, error: 'JSON 不是数组' };
    arr.forEach((raw, i) => {
      const r = buildItem(raw || {}, i + 1);
      if (r.item) items.push(r.item);
    });
  } else {
    src.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const r = parseLine(t, i + 1);
      if (r.item) items.push(r.item);
    });
  }
  if (!items.length) return { ok: false, error: '没有读到任何一条体能训练' };
  // 同一开始时间只留一条，按时间倒序
  const seen = new Set();
  const unique = items.filter((it) => (seen.has(it.importKey) ? false : seen.add(it.importKey)));
  unique.sort((a, b) => b.start - a.start);
  return { ok: true, items: unique };
}

function matchType(type, list) {
  const t = type.toLowerCase();
  return list.some((k) => t.includes(k.toLowerCase()));
}

// 猜"记为"什么：'ball' | 'zone2' | 'walk' | 'skip'
export function guessKind(item) {
  if (matchType(item.type, BALL_TYPES)) return 'ball';
  if (matchType(item.type, MACHINE_TYPES)) return 'zone2';
  if (matchType(item.type, WALK_TYPES)) return item.avgHr != null && item.avgHr >= 115 && item.avgHr <= 145 ? 'zone2' : 'walk';
  return 'skip';
}

// 二区按时长挑模板
export function cardioIdFor(kind, minutes) {
  if (kind === 'ball') return 'ball';
  if (kind === 'walk') return 'walk';
  if (minutes >= 45) return 'zone2-45';
  if (minutes >= 38) return 'zone2-40';
  return 'zone2-30';
}

// 和已有记录比：'exists' 已导入过同一条；'same-day' 当天已有同类手动记录；null 没冲突
export function conflictWith(item, kind, sessions) {
  const activityKind = kind === 'walk' ? 'cardio' : kind;
  for (const s of sessions) {
    if (s.importKey && s.importKey === item.importKey) return 'exists';
  }
  for (const s of sessions) {
    if (s.date !== item.dateKey || !s.cardio) continue;
    const sameKind = kind === 'ball' ? s.activityKind === 'ball' : s.activityKind === activityKind && (kind === 'walk') === (s.cardioId === 'walk');
    if (sameKind) return 'same-day';
  }
  return null;
}

// 生成一条和手动记的一样的活动记录，但起止时间是真实的，并带 source / importKey 用来去重
export function sessionFromItem(item, kind) {
  const activityKind = kind === 'walk' ? 'cardio' : kind;
  return {
    id: `${item.dateKey}-${kind}-${item.start}`,
    date: item.dateKey,
    templateId: null,
    cardioId: cardioIdFor(kind, item.minutes),
    activityKind,
    startedAt: item.start,
    finishedAt: item.end,
    entries: [],
    cardio: { minutes: item.minutes, avgHr: item.avgHr, zone3Min: null, note: `Apple Health · ${item.type}` },
    source: HK_SOURCE,
    importKey: item.importKey,
  };
}

export const KIND_LABELS = { ball: '打球', zone2: '二区', walk: '散步', skip: '跳过' };
