// 整盘合法性 · "什么算合法盘"的唯一一份定义
//
// 本文件从 `tools/reference.mjs` 挪来：`js/engine/generate.js` 出货前要过一遍合法性，
// 而运行时模块不许去够 `tools/`（浏览器里那是一条 404，或者把 bench 代码当产品代码发出去）。
// 语义一行没动，挪动只改了定义住在哪。
//
// 为什么"合法"必须只有一份定义：引擎的自证通道（rules.js + counter.js + pencil.js）之间可以
// 有分歧（那分歧本身就是证据），但"什么算合法盘"若在引擎里再写第二遍，两个测试台就会各自
// 把 bug 写成期望。所以这份定义现在住在 js 里、被两处共用：`tools/reference.mjs` 再导出它，
// 台架的 import 路径不变，仓库里也仍然只有一份。
//
// 两条通道刻意分开：
//   · ringBad / TATAMI —— 增量谓词：只看"刚放下的这一块"的外环，给 randomTiling 当生长守门。
//   · invalidReason    —— 整盘谓词：铺满 / 长方形 / 禁四角 / 记号数 / 方向，只看 rules.js 与
//     counter.js 的公开判据，与各求解器的增量剪枝无关。
// 台架才用的读数件（labelingOf / rectsOf / signature / sampleBoard）留在 tools/reference.mjs。

import { isRectangular, windmillPoints, aroundPoint } from './rules.js';
import { aspectOk } from './counter.js';

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
