// 本地存档：一把钥匙 + 一堆脏数据防护。
//
// 存档里只有两样东西值得留：
//   ① 这一盘是**哪个 seed 的哪一档**——盘面本身是它的函数，重跑一次 `generate()` 就得到同一张盘，
//      所以记号集、答案、铅笔序列都不必穿过 localStorage（存了反而多一份能漂移的真相）；
//   ② 玩家自己画下的那些边（`game.ink()`），以及"用了多少次提示/多少步/多久"。
//
// 键名带版本号：结构以后再改，旧键读出来会因为 `v` 不对被整条丢掉，而不是被当成新结构误读。
//
// 脏数据的口径：这个文件里所有"读"的路径都假设里面躺着的是别人写坏的东西——截断的 JSON、
// 字符串换成数字、数组长度对不上、键名被别的品类占用。任何一条不合式就**只丢那一条**，
// 不抛异常、不清空别的纪录。存档是可损失的，游戏不是。

import { TIERS } from './engine/generate.js';
import { SAME, UNKNOWN, WALL } from './engine/pencil.js';

export const SAVE_KEY = 'tatamibari.save.v1';
const V = 1;
const VALS = [UNKNOWN, WALL, SAME];
/** 档名不在这份表里，本文件自己抄一份：`generate.js::TIERS` 就是唯一出处。 */
const TIER_BY_KEY = new Map(TIERS.map((t) => [t.key, t]));

// ---------------------------------------------------------------- RLE

/**
 * 一条边数组压成 `值x长度` 串：一盘 6×6 有 60 条内部边，绝大多数还没画，
 * 不压缩的话每次点格子都要重写几百个字符。
 */
export function rle(list) {
  const out = [];
  let run = 1;
  for (let i = 1; i <= list.length; i++) {
    if (i < list.length && list[i] === list[i - 1]) run++;
    else {
      out.push(`${list[i - 1]}x${run}`);
      run = 1;
    }
  }
  return out.join(',');
}

/** 解回来并要求**刚好**铺满 n 格、值都在三态里；否则 null（调用方据此丢档）。 */
export function unrle(s, n) {
  if (typeof s !== 'string' || !s.length || !Number.isInteger(n) || n <= 0) return null;
  const out = new Uint8Array(n);
  let at = 0;
  for (const part of s.split(',')) {
    const m = /^([012])x([1-9][0-9]*)$/.exec(part);
    if (!m) return null;
    const v = +m[1];
    const len = +m[2];
    if (!VALS.includes(v) || at + len > n) return null;
    out.fill(v, at, at + len);
    at += len;
  }
  return at === n ? Array.from(out) : null;
}

// ---------------------------------------------------------------- 环境

// 隐私模式、满配额、Electron 里 file:// 的 storage 权限——都只让存档失效，不让游戏失效。
function backend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = '__tatamibari_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isInt = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(x) && x >= min && x <= max;
const isStr = (x, max = 200) => typeof x === 'string' && x.length > 0 && x.length <= max;
const num = (x, fallback = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

const EMPTY = { v: V, resume: null, best: {}, totals: { played: 0, won: 0, hints: 0 } };

/** 深拷贝并逐字段体检；不合规的那一条直接变成"没有"。 */
function sanitize(raw) {
  const out = { v: V, resume: null, best: {}, totals: { ...EMPTY.totals } };
  if (!isObj(raw) || raw.v !== V) return out;

  const r = raw.resume;
  const tier = isObj(r) && TIER_BY_KEY.get(r.tierKey);
  // 尺寸也得跟档名对得上：`generate()` 的盘是 (seed, tier) 的函数，一条说 6×6 一档说 4×4 的存档
  // 说明有人在中间改过，读它回来的结果只会是一张跟画线不匹配的盘。
  if (tier && isStr(r.seed, 120) && isInt(r.w, 1, 40) && isInt(r.h, 1, 40)
    && r.w === tier.size[0] && r.h === tier.size[1]) {
    const n = r.w * r.h;
    const ink = isObj(r.ink) ? r.ink : null;
    const right = ink && unrle(ink.right, n);
    const down = ink && unrle(ink.down, n);
    if (right && down) {
      out.resume = {
        seed: r.seed,
        tierKey: r.tierKey,
        w: r.w,
        h: r.h,
        ink: { right, down },
        moves: isInt(r.moves) ? r.moves : 0,
        hints: isInt(r.hints) ? r.hints : 0,
        prunes: isInt(r.prunes) ? r.prunes : 0,
        elapsedMs: num(r.elapsedMs, 0),
        daily: r.daily === true,
        savedAt: isInt(r.savedAt) ? r.savedAt : 0,
      };
    }
  }

  if (isObj(raw.best)) {
    for (const key of TIER_BY_KEY.keys()) {
      const b = raw.best[key];
      if (!isObj(b) || !isInt(b.hints) || !isInt(b.moves) || !isInt(b.ms)) continue;
      out.best[key] = {
        hints: b.hints,
        moves: b.moves,
        ms: b.ms,
        seed: isStr(b.seed, 120) ? b.seed : '',
        at: isInt(b.at) ? b.at : 0,
      };
    }
  }

  const t = raw.totals;
  if (isObj(t)) {
    for (const k of Object.keys(EMPTY.totals)) out.totals[k] = isInt(t[k]) ? t[k] : 0;
  }
  return out;
}

/** 纪录比较：先看不求提示的次数，再看步数，最后看时间——和提示"不许当答案按钮"同一条口径。 */
export function beats(a, b) {
  if (!a || !b) return true;
  if (a.hints !== b.hints) return a.hints < b.hints;
  if (a.moves !== b.moves) return a.moves < b.moves;
  return a.ms < b.ms;
}

// ---------------------------------------------------------------- 门面

export class Store {
  constructor(data = structuredClone(EMPTY)) {
    this.data = data;
  }

  static load() {
    const ls = backend();
    let raw = null;
    try {
      const text = ls && ls.getItem(SAVE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null; // 截断的 JSON、被人改成 "undefined" 的键，都只到这里为止
    }
    const s = new Store(sanitize(raw));
    s.ls = ls;
    return s;
  }

  get resume() {
    return this.data.resume;
  }

  get totals() {
    return this.data.totals;
  }

  bestFor(tierKey) {
    return this.data.best[tierKey] || null;
  }

  /** 把当前局面写成"可续玩"的那条。ink 来自 `game.ink()`，长度必须是 w*h。 */
  saveResume(rec) {
    if (!isObj(rec) || !isStr(rec.seed, 120) || !isObj(rec.ink)) return false;
    const n = rec.w * rec.h;
    if (!isInt(rec.w, 1, 40) || !isInt(rec.h, 1, 40)) return false;
    if (!Array.isArray(rec.ink.right) || rec.ink.right.length !== n) return false;
    if (!Array.isArray(rec.ink.down) || rec.ink.down.length !== n) return false;
    this.data.resume = {
      seed: rec.seed,
      tierKey: rec.tierKey,
      w: rec.w,
      h: rec.h,
      ink: { right: rle(rec.ink.right), down: rle(rec.ink.down) },
      moves: isInt(rec.moves) ? rec.moves : 0,
      hints: isInt(rec.hints) ? rec.hints : 0,
      prunes: isInt(rec.prunes) ? rec.prunes : 0,
      elapsedMs: num(rec.elapsedMs, 0),
      daily: rec.daily === true,
      savedAt: Date.now(),
    };
    return this.flush();
  }

  clearResume() {
    this.data.resume = null;
    return this.flush();
  }

  /** 赢了一盘：更新该档纪录并累计总量。返回是不是新纪录。`played` 由 submitStart 记，这里不重复加。 */
  submitWin(tierKey, { hints = 0, moves = 0, ms = 0, seed = '' } = {}) {
    const rec = { hints, moves, ms, seed, at: Date.now() };
    const prev = this.bestFor(tierKey);
    const isBest = beats(rec, prev);
    if (isBest) this.data.best[tierKey] = rec;
    this.data.totals.won += 1;
    this.data.totals.hints += hints;
    this.flush();
    return { isBest, prev, rec };
  }

  /** 开局就记一笔：让"打了多少盘"不必等到赢才算。 */
  submitStart() {
    this.data.totals.played += 1;
    this.flush();
  }

  reset() {
    this.data = structuredClone(EMPTY);
    try {
      if (this.ls) this.ls.removeItem(SAVE_KEY);
    } catch {
      /* 清不掉也只能由它去 */
    }
    return this.flush();
  }

  flush() {
    try {
      if (this.ls) this.ls.setItem(SAVE_KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false; // 配额满：这次写不进去，内存里的仍然能用
    }
  }
}

export default Store;
