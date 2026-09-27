// 唯一解计数器 · 记号引导
//
// 本盘的成本问题不是"检查一条规则贵不贵"，而是"要检查多少张盘"。
// 无约束的长方形分块在 5×5 就有 84,231,996 个（数字来源见选型卡），
// 所以任何"先枚举分块再筛记号/禁四角"的做法都封不住预算。
//
// 封住它的是下面这条结构事实：
//
//   按光栅序取第一个未填格 p，则覆盖 p 的那一块**必须以 p 为左上角**。
//   证明：矩形里最靠光栅序的格就是它的左上角 t；若 t < p，则放置 t 时 p 已被该块占走，
//   与"p 是第一个未填格"矛盾。故 t = p。∎
//
//   推论 1：每步的候选只剩"以 p 为左上角"的矩形，数量 ≤ (h-pr)·(w-pc)。
//   推论 2：再加一条"恰好含 1 个未使用记号且方向相符"，候选通常只剩个位数。
//   推论 3：每个分块恰好被产生一次（左上角顺序即放置顺序），所以计数不重不漏。
//
// 于是本文件给出两条彼此独立的实现，测试台逐盘对答案：
//   countAnchored —— 上面这条锚定性质 + 前缀和选记号，门禁跑它；
//   countCover    —— 完全不假设锚定：枚举每个记号的全部合法矩形（任意位置），
//                    再按 MRV（候选最少的未覆盖格）做精确覆盖。慢一到两个数量级，
//                    但分支顺序、状态表示、记号记账都和上面那条无关。
// 两者只共享 js/engine/rules.js 里的规则语义（`pointWindmill`、长方形方向的定义），
// 那份语义本身由 tools/rule-test.mjs 用穷举钉住。
//
// 唯一性证明的正确用法是 `limitSolutions: 2`：跑完只数到 1 个解，就意味着
// 整棵树已穷尽、第二个解不存在。反过来说，"要证明唯一"和"要把解数完"不是一回事——
// 数完一个松盘的解可能上百毫秒，而证明唯一在同样这张盘上不到 0.1 ms 就断了。

import { pointWindmill } from './rules.js';

/** 记号类型：`-` 宽>高、`|` 高>宽、`+` 正方形 */
export const T_WIDE = 0, T_TALL = 1, T_SQUARE = 2;
export const MARKER_CHAR = ['-', '|', '+'];

/** 由矩形尺寸读记号 */
export function markerTypeFor(ww, hh) {
  if (ww > hh) return T_WIDE;
  if (hh > ww) return T_TALL;
  return T_SQUARE;
}

/** 尺寸 ww×hh 是否满足记号 type 的方向约束 */
export function aspectOk(ww, hh, type) {
  if (type === T_WIDE) return ww > hh;
  if (type === T_TALL) return hh > ww;
  return ww === hh;
}

/**
 * 出题器与证明器之间的边界：记号必须落在盘内且互不重叠。
 * 重叠的输入会让两套计数器**一起**给出同一个错数，对答案也查不出来，只能在这里挡。
 * 顺便把 cell -> 记号 id 的表填进 at，调用方复用这一遍扫描。
 */
export function checkMarkers(w, h, markers, at) {
  markers.forEach((m, mi) => {
    if (!(m.r >= 0 && m.r < h && m.c >= 0 && m.c < w)) throw new Error(`记号 ${mi} 越界 (${m.r},${m.c})`);
    const i = m.r * w + m.c;
    if (at[i] >= 0) throw new Error(`记号 ${mi} 与记号 ${at[i]} 重叠于 (${m.r},${m.c})`);
    at[i] = mi;
  });
  return at;
}

/**
 * @param markers [{r, c, type}]，本盘的记号（区域数必须等于记号数）
 * @param opts {limitSolutions=Infinity, nodeBudget=Infinity, onSolution}
 * @returns {{sols:number, nodes:number, ms:number, stopped:boolean, solution:?Array}}
 *   `stopped` 为真表示节点预算被击穿——**此时 sols 是下界而不是答案**，
 *   调用方必须把它当成"未证完"（选型卡的 OVERBUDGET 门禁），不得当成"没有更多解"。
 */
export function countAnchored(w, h, markers, opts = {}) {
  const limit = opts.limitSolutions ?? Infinity;
  const budget = opts.nodeBudget ?? Infinity;
  const M = markers.length;

  // 前缀和：矩形里的记号个数 + 记号 id 之和。个数恰为 1 时，和就是那个 id，
  // 于"这块属于哪个记号"是 O(1) 判定，不用扫矩形。
  const PW = w + 1;
  const cntA = new Int32Array(PW * (h + 1));
  const sumA = new Int32Array(PW * (h + 1));
  const cm = new Int32Array(w * h).fill(-1);
  const mtype = new Int8Array(M);
  markers.forEach((m, i) => { mtype[i] = m.type; });
  checkMarkers(w, h, markers, cm);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const id = cm[r * w + c];
    cntA[(r + 1) * PW + c + 1] = cntA[r * PW + c + 1] + cntA[(r + 1) * PW + c] - cntA[r * PW + c] + (id >= 0 ? 1 : 0);
    sumA[(r + 1) * PW + c + 1] = sumA[r * PW + c + 1] + sumA[(r + 1) * PW + c] - sumA[r * PW + c] + (id >= 0 ? id : 0);
  }
  const rectMarkers = (r0, c0, r1, c1) => {
    const a = r0 * PW + c0, b = r0 * PW + c1 + 1, e = (r1 + 1) * PW + c0, d = (r1 + 1) * PW + c1 + 1;
    return [cntA[d] - cntA[b] - cntA[e] + cntA[a], sumA[d] - sumA[b] - sumA[e] + sumA[a]];
  };

  const occ = new Int32Array(w * h).fill(-1);
  const used = new Uint8Array(M);
  const placed = [];
  let nextRegion = 0, sols = 0, nodes = 0, stopped = false;
  let solution = null;

  // 刚放置 [r0..r1]×[c0..c1] 后，只有该矩形环带上的格点状态可能从"未知"变成"已判定"，
  // 所以只查环带；环带外的点要么早就查过，要么还缺格（缺格 ⇒ 现在不可能违规）。
  function ringViolates(r0, c0, r1, c1) {
    for (let y = r0; y <= r1 + 1; y++) {
      const rowEdge = y === r0 || y === r1 + 1;
      for (let x = c0; x <= c1 + 1; x++) {
        if ((rowEdge || x === c0 || x === c1 + 1) && pointWindmill(occ, w, h, x, y)) return true;
      }
    }
    return false;
  }

  function dfs(pr, pc) {
    if (++nodes > budget) { stopped = true; return false; }
    // clear[c] = "列 c 从本层起点 pr 到当前 r1 之间是否全空"。它必须**每层一份**：
    // 共用一个数组会被内层递归踩脏，而踩脏之后是**少数解**——沉默的错误。
    const clear = new Uint8Array(w).fill(1);
    const cands = [];
    for (let r1 = pr; r1 < h; r1++) {
      let rowAnd = 1;
      for (let c1 = pc; c1 < w; c1++) {
        if (clear[c1] && occ[r1 * w + c1] === -1) clear[c1] = 1; else clear[c1] = 0;
        rowAnd = rowAnd && clear[c1];
        if (!rowAnd) continue;                       // [pr..r1]×[pc..c1] 还没全空
        const [n, s] = rectMarkers(pr, pc, r1, c1);
        if (n !== 1 || used[s]) continue;             // 必须恰好吞掉一个还没被用的记号
        if (aspectOk(c1 - pc + 1, r1 - pr + 1, mtype[s])) cands.push([r1, c1, s]);
      }
    }
    for (const [r1, c1, mid] of cands) {
      used[mid] = 1;
      const rid = nextRegion++;
      for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = rid;
      placed.push([pr, pc, r1, c1, mid, rid]);

      let p2 = -1;
      for (let i = 0; i < w * h; i++) if (occ[i] === -1) { p2 = i; break; }
      const bad = ringViolates(pr, pc, r1, c1);
      let go = true;
      if (!bad) {
        if (p2 < 0) {
          sols++;
          if (opts.onSolution || !solution) {
            const snapshot = solutionFor(placed);
            if (!solution) solution = snapshot;
            if (opts.onSolution) opts.onSolution(snapshot);
          }
          go = sols < limit;
        } else {
          go = dfs((p2 / w) | 0, p2 % w);
        }
      }

      placed.pop();
      for (let r = pr; r <= r1; r++) for (let c = pc; c <= c1; c++) occ[r * w + c] = -1;
      nextRegion--;
      used[mid] = 0;
      if (!go) return false;
    }
    return true;
  }

  const t0 = performance.now();
  dfs(0, 0);
  return { sols, nodes, ms: performance.now() - t0, stopped, solution };
}

function solutionFor(placed) {
  return placed.map((p) => ({ r0: p[0], c0: p[1], r1: p[2], c1: p[3], marker: p[4] }));
}

/**
 * 独立审计版：不假设锚定性质。
 * 每个记号先枚举它**能落在的任何位置**的矩形（包括左上角在别处的），
 * 然后每次挑"候选放置最少的未覆盖格"（MRV）来分支，用 BigInt 位掩码管覆盖。
 * 慢，但和 countAnchored 只共享规则语义。
 * @param opts {limitSolutions=Infinity, nodeBudget=Infinity, onSolution}
 */
export function countCover(w, h, markers, opts = {}) {
  const limit = opts.limitSolutions ?? Infinity;
  const budget = opts.nodeBudget ?? Infinity;
  const N = w * h;
  const bit = (i) => 1n << BigInt(i);
  const FULL = (1n << BigInt(N)) - 1n;
  const markerAt = new Int32Array(N).fill(-1);
  checkMarkers(w, h, markers, markerAt);

  const options = markers.map((m, mi) => {
    const out = [];
    for (let r0 = 0; r0 <= m.r; r0++) for (let r1 = m.r; r1 < h; r1++)
      for (let c0 = 0; c0 <= m.c; c0++) for (let c1 = m.c; c1 < w; c1++) {
        if (!aspectOk(c1 - c0 + 1, r1 - r0 + 1, m.type)) continue;
        let mask = 0n;
        const cells = [];
        let swallows = false;
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          mask |= bit(r * w + c); cells.push(r * w + c);
          if (markerAt[r * w + c] >= 0 && r * w + c !== m.r * w + m.c) swallows = true;
        }
        // "每块恰好一个记号"有两条半：包含自己的记号（由构造保证）、
        // **不包含别人的记号**（这条最容易漏，漏了就多算解）、块数=记号数（由覆盖完整性保证）。
        if (swallows) continue;
        out.push({ mask, cells, r0, c0, r1, c1, mi });
      }
    return out;
  });
  const perCell = Array.from({ length: N }, () => []);
  options.forEach((list, mi) => list.forEach((o, oi) => {
    for (const cell of o.cells) perCell[cell].push({ mi, oi });
  }));

  const used = new Uint8Array(markers.length);
  const lab = new Int32Array(N).fill(-1);
  const stack = [];
  let covered = 0n, nextId = 0, sols = 0, nodes = 0, stopped = false;

  function ringViolates(o) {
    for (let y = o.r0; y <= o.r1 + 1; y++) {
      const rowEdge = y === o.r0 || y === o.r1 + 1;
      for (let x = o.c0; x <= o.c1 + 1; x++) {
        if ((rowEdge || x === o.c0 || x === o.c1 + 1) && pointWindmill(lab, w, h, x, y)) return true;
      }
    }
    return false;
  }

  function rec() {
    if (++nodes > budget) { stopped = true; return false; }
    if (covered === FULL) {
      // 走到这里不必再查"有没有记号没被用"：每个已放矩形恰好含 1 个记号、记号不可复用，
      // 而全盘已被覆盖 ⇒ 所有记号都在某个矩形里 ⇒ 用掉的记号数 = 矩形数 = M。
      sols++;
      if (opts.onSolution) opts.onSolution(stack.map((o) => ({ ...o, marker: o.mi })));
      return sols < limit;
    }
    let best = -1, bestN = Infinity;
    for (let cell = 0; cell < N; cell++) {
      if ((covered >> BigInt(cell)) & 1n) continue;
      let n = 0;
      for (const { mi, oi } of perCell[cell]) {
        if (used[mi] || (options[mi][oi].mask & covered)) continue;
        n++;
      }
      if (n === 0) return true;
      if (n < bestN) { bestN = n; best = cell; if (n === 1) break; }
    }
    for (const { mi, oi } of perCell[best]) {
      if (used[mi] || (options[mi][oi].mask & covered)) continue;
      const o = options[mi][oi];
      used[mi] = 1;
      const id = nextId++;
      for (const c of o.cells) { lab[c] = id; covered |= bit(c); }
      stack.push(o);
      let go = true;
      if (!ringViolates(o)) go = rec();
      stack.pop();
      for (const c of o.cells) { lab[c] = -1; covered &= ~bit(c); }
      nextId--;
      used[mi] = 0;
      if (!go) return false;
    }
    return true;
  }

  const t0 = performance.now();
  rec();
  return { sols, nodes, ms: performance.now() - t0, stopped };
}
