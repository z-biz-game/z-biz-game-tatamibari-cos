// 唯一解计数器的成本台 · 出货门禁 budgetMs 的基线从这里取
//
// 门禁真正跑的是 `countAnchored(..., { limitSolutions: 2 })`：跑完只数到 1 个解
// 就等于证明了唯一解。所以这里量的不是"数完一张松盘要多久"，而是
// **出货那一类盘（已确认唯一）证明唯一要多久**，以及这条路上有没有长尾巴。
//
// 输出里的每个数字都是这一台机器上跑出来的绝对值（不是相对量），
// 因为预算必须是实测尾巴（p95/max），不是中位数×2。
//
//   node tools/counter-cost.mjs              默认 6×6 / 8×8 / 10×10 三档
//   node tools/counter-cost.mjs 10 10 40     只跑一档

import { countAnchored, countCover } from '../js/engine/counter.js';
import { randomTiling, markersFromTiling, mulberry32, quantile } from './tiling_enum.mjs';
import { aroundPoint } from '../js/engine/rules.js';

function ringBad(occ, w, h, r0, c0, r1, c1) {
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

function sampleBoard(w, h, seed) {
  const rnd = mulberry32(seed);
  const rects = randomTiling(w, h, { rnd, accept: (occ, ww, hh, r0, c0, r1, c1) => !ringBad(occ, ww, hh, r0, c0, r1, c1) });
  return rects ? markersFromTiling(rects, rnd) : null;
}

const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
function row(name, xs) {
  if (!xs.length) { console.log(`  ${name.padEnd(18)} 无样本`); return; }
  console.log(`  ${name.padEnd(18)} n=${String(xs.length).padStart(4)}  中位 ${f2(quantile(xs, .5)).padStart(7)}  p95 ${f2(quantile(xs, .95)).padStart(8)}  max ${f2(quantile(xs, 1)).padStart(9)}`);
}

const NODE_BUDGET = 3e6;

function run(w, h, want) {
  const uniqMs = [], uniqNodes = [], allMs = [], sols = [], regs = [];
  let tries = 0, overBudget = 0, genFail = 0, coverChecked = 0, coverDisagree = 0;
  const t0 = performance.now();
  // 1) 全量：随机合法盘的解数分布与"数到底"的成本（这是 OVERBUDGET 风险的来源）
  for (let i = 0; i < 200; i++) {
    tries++;
    const mk = sampleBoard(w, h, 900 + i * 7919);
    if (!mk) { genFail++; continue; }
    const r = countAnchored(w, h, mk, { nodeBudget: NODE_BUDGET });
    if (r.stopped) { overBudget++; continue; }
    allMs.push(r.ms); sols.push(r.sols); regs.push(mk.length);
    if (coverChecked < 5 && r.sols <= 2000) {
      const c = countCover(w, h, mk, { nodeBudget: NODE_BUDGET });
      if (!c.stopped) { coverChecked++; if (c.sols !== r.sols) coverDisagree++; }
    }
  }
  const rateFull = overBudget / Math.max(1, tries);
  // 2) 出货门禁路径：只保留"数到 2 仍是 1"的盘，量它们的证明成本
  const unique = [];
  tries = 0;
  const cap = 6000;
  while (unique.length < want && tries < cap) {
    const mk = sampleBoard(w, h, 900 + tries * 7919 + 13);
    tries++;
    if (!mk) continue;
    const g = countAnchored(w, h, mk, { limitSolutions: 2, nodeBudget: NODE_BUDGET });
    if (g.stopped) continue;
    if (g.sols === 1) unique.push(g);
  }
  for (const g of unique) { uniqMs.push(g.ms); uniqNodes.push(g.nodes); }

  console.log(`\n=== ${w}×${h} ===`);
  console.log(`  区域数(=记号数)：中位 ${quantile(regs, .5)} max ${quantile(regs, 1)}`);
  row('全计数墙钟 ms', allMs);
  console.log(`  解数：中位 ${quantile(sols, .5)}  p95 ${quantile(sols, .95)}  max ${quantile(sols, 1)}`);
  console.log(`  随机盘里数到底的超预算率：${overBudget}/${tries - genFail} = ${(100 * rateFull).toFixed(1)}%（这些盘不能出货，只能弃）`);
  console.log(`  与 MRV 审计版对照 ${coverChecked} 张，解数分歧 ${coverDisagree}`);
  console.log(`  —— 门禁路径（limitSolutions:2，只统计证明出唯一的盘）——`);
  console.log(`  唯一解命中率 ${(100 * unique.length / Math.max(1, tries)).toFixed(1)}%（尝试 ${tries}）`);
  row('证明墙钟 ms', uniqMs);
  row('证明节点', uniqNodes);
  const p95 = quantile(uniqMs, .95), mx = quantile(uniqMs, 1);
  console.log(`  budgetMs 建议 = max(p95×4, max×2) = ${f2(Math.max(p95 * 4, mx * 2))} ms`);
  console.log(`    ↑ 必须盖过实测 max：击穿意味着**弃盘**（安全，但白扔一张已证唯一的盘），`);
  console.log(`      而 p95×4 在 10×10 上会小于 max，单用它会弃真盘。`);
  console.log(`  本档台架总墙钟 ${(performance.now() - t0).toFixed(0)} ms`);
}

const args = process.argv.slice(2);
if (args.length >= 2) run(+args[0], +args[1], +(args[2] || 60));
else for (const [w, h, n] of [[6, 6, 80], [8, 8, 80], [10, 10, 60]]) run(w, h, n);
