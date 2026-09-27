// 测试台参照件：真值盘生成与解集签名
//
// 【分层】"什么算合法盘"的定义（ringBad / TATAMI / invalidReason）现在住在
// js/engine/validate.js —— 因为出题器出货就要用它，而运行时模块不许去够 tools/。
// 本文件把那三个名字**再导出**一次，台架的 import 路径与断言一行都不用改；
// 仓库里仍然只有一份定义（这是关键：合法定义写第二遍，两个测试台就会各自把 bug 写成期望）。
// 留下的都是台架专用的读数件：labelingOf / rectsOf / signature / sampleBoard——
// 引擎自己一行都不引用它们（出货走 generate.js 的 plantedBoard，另有它自己的读数通道）。

import { randomTiling, markersFromTiling, mulberry32 } from '../js/engine/tiling.js';
import { TATAMI, invalidReason } from '../js/engine/validate.js';

// 老路径 re-export：balance / counter-test / pencil-test 仍从 './reference.mjs' 取这两条通道。
export { TATAMI, invalidReason };

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
