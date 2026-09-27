// 随机长方形分块 · 出题器的种盘通道
//
// 本文件从 `tools/tiling_enum.mjs` 挪来（挪之前 `js/engine/generate.js` 反向 import 了 tools，
// 那是分层倒置：一个要进浏览器的运行时模块去够 bench 目录）。语义一行没动，挪动只改了定义住在哪。
//
// 分层的界线按"引擎出货要不要它"划，不按"它长在哪个文件里"划：
//   · randomTiling / markersFromTiling / mulberry32 —— 生成器出货要用的，所以在这里。
//     `randomTiling` 走的是**锚定式生长**（第一个未定格 = 新块左上角），自带 DFS 与预算，
//     不依赖任何穷举枚举器；它唯一的模块内依赖是私有洗牌 `order`，所以 `order` 跟着它一起搬。
//   · eachRectTiling / countAnchoredTilings / quantile —— 留在 tools：
//     穷举全部矩形分块是"封不住成本的走法"（见 counter.js 开头），引擎永远不许调它，
//     它只当测试台的参照物；quantile 是分位数读数，同理。
//     `tools/tiling_enum.mjs` 现在把上面三个名字从本文件再导出，台架的 import 路径不用改。
//
// 确定性：随机数一律来自调用方传进来的 rnd（mulberry32 的种子由生成器给），没有 Math.random；
// 抽随机数绝不发生在 sort 的比较器里——node 与 Chrome 排序实现不同，同 seed 会给出两张盘。

/**
 * 随机长出一个满足 accept 的分块，返回矩形列表；找不到返回 null。
 * accept(occ, w, h, r0, c0, r1, c1) 在"刚放好这一块"的状态下判断是否允许，
 * 传禁四角检查就是它——生长时就守住角，而不是切完再筛。
 */
export function randomTiling(w, h, { accept, rnd, nodeBudget = 500000 }) {
  const N = w * h;
  const occ = new Int32Array(N).fill(-1);
  const placed = [];
  let next = 0, nodes = 0;
  function dfs(pr, pc) {
    if (++nodes > nodeBudget) return false;
    const clear = new Uint8Array(w).fill(1);   // 每层一份，理由见 tools/tiling_enum.mjs 的 countAnchoredTilings
    const cands = [];
    for (let r1 = pr; r1 < h; r1++) {
      let rowAnd = 1;
      for (let c1 = pc; c1 < w; c1++) {
        if (clear[c1] && occ[r1 * w + c1] === -1) clear[c1] = 1; else clear[c1] = 0;
        rowAnd = rowAnd && clear[c1];
        if (rowAnd) cands.push([r1, c1]);
      }
    }
    for (const [r1, c1] of order(cands, rnd)) {
      const rid = next++;
      for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = rid;
      placed.push({ r0: pr, c0: pc, r1, c1, rid });
      let go = false;
      if (accept(occ, w, h, pr, pc, r1, c1)) {
        let p2 = -1;
        for (let i = 0; i < N; i++) if (occ[i] === -1) { p2 = i; break; }
        go = p2 < 0 || dfs((p2 / w) | 0, p2 % w);
      }
      if (go) return true;
      placed.pop();
      for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = -1;
      next--;
    }
    return false;
  }
  return dfs(0, 0) ? placed : null;
}

function order(list, rnd) {
  if (!rnd) return list;
  for (let i = list.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = list[i]; list[i] = list[j]; list[j] = t;
  }
  return list;
}

/** 由矩形列表读出记号盘：每块随机一格放记号，类型由该块形状决定。 */
export function markersFromTiling(rects, rnd) {
  return rects.map((p) => {
    const hh = p.r1 - p.r0 + 1, ww = p.c1 - p.c0 + 1;
    const type = ww > hh ? 0 : hh > ww ? 1 : 2;
    const r = p.r0 + ((rnd() * hh) | 0), c = p.c0 + ((rnd() * ww) | 0);
    return { r, c, type };
  });
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
