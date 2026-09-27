// 测试台参照件：整盘合法性检查与真值盘生成
//
// 这些函数**只服务于测试台**，产品代码一行都不引用它们——这是故意的：
// 引擎的自证通道（rules.js + counter.js + pencil.js）之间可以有分歧，
// 但"什么算合法盘"必须只有一份定义，否则两个测试台会各自把 bug 写成期望。

import { isRectangular, windmillPoints, aroundPoint } from '../js/engine/rules.js';
import { aspectOk } from '../js/engine/counter.js';
import { randomTiling, markersFromTiling, mulberry32 } from './tiling_enum.mjs';

/** 生长时的禁四角守门：走 rules.js 的 aroundPoint，与 counter.js 内部的环带实现无关 */
export function ringBad(occ, w, h, r0, c0, r1, c1) {
  for (let y = r0; y <= r1 + 1; y++) {
    const rowEdge = y === r0 || y === r1 + 1;
    for (let x = c0; x <= c1 + 1; x++) {
      if (!(rowEdge || x === c0 || x === c1 + 1)) continue;
      if (x < 1 || y < 1 || x > w - 1 || y > h - 1) continue;
      const q = aroundPoint(occ, w, x, y);
      if (q.some((v) => v < 0)) continue;
      if (q[0] !== q[1] && q[0] !== q[2] && q[0] !== q[3] &&
        q[1] !== q[2] && q[1] !== q[3] && q[2] !== q[3]) return true;
    }
  }
  return false;
}

export const TATAMI = (occ, w, h, r0, c0, r1, c1) => !ringBad(occ, w, h, r0, c0, r1, c1);

/** 矩形列表 → 每格区域号（-1 = 没铺满） */
export function labelingOf(rects, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  rects.forEach((p, id) => {
    for (let r = p.r0; r <= p.r1; r++) for (let c = p.c0; c <= p.c1; c++) lab[r * w + c] = id;
  });
  return lab;
}

/** 把 labeling 摊平成矩形列表（按左上角排序） */
export function rectsOf(lab, w, h) {
  const acc = new Map();
  for (let i = 0; i < w * h; i++) {
    const id = lab[i];
    if (id < 0) return null;
    const r = (i / w) | 0, c = i % w;
    const b = acc.get(id);
    if (!b) acc.set(id, { r0: r, c0: c, r1: r, c1: c });
    else { if (r < b.r0) b.r0 = r; if (r > b.r1) b.r1 = r; if (c < b.c0) b.c0 = c; if (c > b.c1) b.c1 = c; }
  }
  return [...acc.values()].sort((a, b) => (a.r0 - b.r0) || (a.c0 - b.c0));
}

/** 整盘合法性检查，返回 null 表示合法。只用 rules.js，与各求解器的增量剪枝无关。 */
export function invalidReason(w, h, markers, rects) {
  const lab = new Int32Array(w * h).fill(-1);
  rects.forEach((p, id) => {
    for (let r = p.r0; r <= p.r1; r++) for (let c = p.c0; c <= p.c1; c++) lab[r * w + c] = id;
  });
  if (lab.some((v) => v < 0)) return '没铺满';
  if (!isRectangular(lab, w, h)) return '有块不是长方形';
  if (windmillPoints(lab, w, h).length) return '有四块共角';
  if (rects.length !== markers.length) return '块数与记号数不等';
  const owner = new Int32Array(w * h).fill(-1);
  markers.forEach((m, mi) => { owner[m.r * w + m.c] = mi; });
  const perRegion = new Int32Array(rects.length).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (owner[i] < 0) continue;
    const id = lab[i];
    if (perRegion[id] >= 0) return '某块含两个记号';
    perRegion[id] = owner[i];
  }
  for (let id = 0; id < rects.length; id++) {
    if (perRegion[id] < 0) return '某块没有记号';
    const p = rects[id], m = markers[perRegion[id]];
    if (!aspectOk(p.c1 - p.c0 + 1, p.r1 - p.r0 + 1, m.type)) return '方向与记号不符';
  }
  return null;
}

/** 解集签名：矩形按左上角排序，带它吞掉的记号 id */
export function signature(sol) {
  return sol.map((p) => `${p.r0},${p.c0},${p.r1},${p.c1}#${p.marker}`).sort().join(' ');
}

/**
 * 长一张真值盘：满足禁四角的随机分块 + 每块一个记号。
 * 返回里带 lab（真值区域号），所以它既是"输入的种子"也是"答案的对照"。
 */
export function sampleBoard(w, h, seed) {
  const rnd = mulberry32(seed);
  const rects = randomTiling(w, h, { rnd, accept: TATAMI });
  if (!rects) return null;
  const markers = markersFromTiling(rects, rnd);
  return { rects, markers, lab: labelingOf(rects, w, h) };
}
