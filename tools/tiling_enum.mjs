// 长方形分块枚举 · 测试台的参照实现
//
// 放在 tools 而不是 js/engine：引擎出货时不需要"枚举全部分块"（那是封不住成本的走法，
// 见 js/engine/counter.js 开头），但测试台需要它当参照物——两套更快的实现必须和它逐盘对得上。
//
// 这里有两个彼此独立的枚举器，它们的分歧/一致本身就是"锚定性质不重不漏"的证据：
//   eachRectTiling     —— 朴素版：取第一个未定格，枚举它所属矩形的一切可能尺寸（尺寸循环）。
//   countAnchoredTilings —— 锚定版：同样取第一个未定格，但按"左上角 = 该格"来展开 (r1,c1)。
//   两者对同一个 w×h 必须给出同一个分块数，且 1×n 的分块数必须等于可手算的 2^(n-1)。

/** 朴素版：逐个分块回调 cb(labeling)，labeling 是 Int8Array（区域 id）。 */
export function eachRectTiling(w, h, cb, budget = Infinity) {
  const N = w * h;
  const used = new Uint8Array(N);
  const lab = new Int8Array(N).fill(-1);
  let next = 0, hit = 0, stopped = false;
  const rec = () => {
    if (stopped) return;
    let i = 0; while (i < N && used[i]) i++;
    if (i === N) { hit++; cb(lab); if (hit >= budget) stopped = true; return; }
    const r0 = (i / w) | 0, c0 = i % w;
    for (let hh = 1; r0 + hh <= h; hh++) {
      for (let ww = 1; c0 + ww <= w; ww++) {
        let fits = true;
        for (let r = r0; r < r0 + hh && fits; r++) {
          for (let c = c0; c < c0 + ww; c++) if (used[r * w + c]) { fits = false; break; }
        }
        if (!fits) continue;
        for (let r = r0; r < r0 + hh; r++) for (let c = c0; c < c0 + ww; c++) { used[r * w + c] = 1; lab[r * w + c] = next; }
        next++; rec(); next--;
        for (let r = r0; r < r0 + hh; r++) for (let c = c0; c < c0 + ww; c++) { used[r * w + c] = 0; lab[r * w + c] = -1; }
      }
    }
  };
  rec();
  return { hit, stopped };
}

/** 锚定版计数器（无记号、无禁四角，只数分块）：与 eachRectTiling 必须给出同一个数。 */
export function countAnchoredTilings(w, h, budget = Infinity) {
  const N = w * h;
  const occ = new Uint8Array(N);          // 1 = 已填
  let hit = 0, stopped = false;
  function dfs(pr, pc) {
    if (stopped) return;
    // clear 必须**每层一份**：它记的是"本层起点 pr 到当前 r1 之间这一列是否全空"，
    // 复用同一个数组会被内层递归踩脏，而踩脏之后是**少数**而不是报错——
    // 这一条就是本函数与 eachRectTiling 对答案抓到的第一个 bug。
    const clear = new Uint8Array(w).fill(1);
    for (let r1 = pr; r1 < h; r1++) {
      let rowAnd = 1;
      for (let c1 = pc; c1 < w; c1++) {
        if (clear[c1] && !occ[r1 * w + c1]) clear[c1] = 1; else clear[c1] = 0;
        rowAnd = rowAnd && clear[c1];
        if (!rowAnd) continue;
        for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = 1;
        let p2 = -1;
        for (let i = 0; i < N; i++) if (!occ[i]) { p2 = i; break; }
        if (p2 < 0) { hit++; if (hit >= budget) stopped = true; }
        else dfs((p2 / w) | 0, p2 % w);
        for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = 0;
        if (stopped) return;
      }
    }
  }
  dfs(0, 0);
  return { hit, stopped };
}

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
    const clear = new Uint8Array(w).fill(1);   // 每层一份，理由见 countAnchoredTilings
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

/** 分位数：默认返回排序后的 p 位置（取尾巴而不是中位×2，见项目记忆）。 */
export function quantile(xs, p) {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN;
}
