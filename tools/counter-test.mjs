// 唯一解计数器测试台
//
// 这里要钉住"出货前用穷举证明唯一解"这句承诺的机器部分。成立条件三条，各一节：
//   A) 计数器数到的**每一个**解，都由另一套代码（js/engine/rules.js 的整盘实现）复核过合法；
//   B) 不重不漏由三方对答案：锚定式、MRV 精确覆盖式、朴素全枚举（4×4 那 70,878 个分块），
//      而且比的是**解集**（签名逐条对齐），不是只比解的个数——个数相同但集合不同也是 bug；
//   C) `limitSolutions: 2` 是"证明唯一"的正确用法：跑完只数到 1 ⇒ 整棵树已穷尽。
//
// 成本不在这里量（这里只保证正确），在 tools/counter-cost.mjs。

import {
  countAnchored, countCover, markerTypeFor, aspectOk, T_WIDE, T_TALL, T_SQUARE, MARKER_CHAR,
} from '../js/engine/counter.js';
import { pointWindmill } from '../js/engine/rules.js';
import { eachRectTiling } from './tiling_enum.mjs';
// 合法性检查、真值盘生成、解集签名都住在 reference.mjs：两个测试台必须共用同一份定义
import { invalidReason, sampleBoard, signature } from './reference.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}
function eq(name, got, want) { ok(name, got === want, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`); }

// ============================================================ A) 记号 ↔ 尺寸
console.log('== A) 记号与方向的对应 ==');
eq('1×1 是 +', markerTypeFor(1, 1), T_SQUARE);
eq('宽 2 高 1 是 -', markerTypeFor(2, 1), T_WIDE);
eq('宽 1 高 2 是 |', markerTypeFor(1, 2), T_TALL);
eq('2×2 也是 +', markerTypeFor(2, 2), T_SQUARE);
eq('- 接受 3×1', aspectOk(3, 1, T_WIDE), true);
eq('+ 不接受 3×1', aspectOk(3, 1, T_SQUARE), false);
eq('- 不接受 2×2', aspectOk(2, 2, T_WIDE), false);
eq('| 不接受 2×2', aspectOk(2, 2, T_TALL), false);
eq('记号字符表', MARKER_CHAR.join(''), '-|+');

// ============================================================ B1) 与朴素全枚举对答案
console.log('\n== B1) 锚定式 vs 朴素全枚举（4×4 的全部 70,878 个长方形分块）==');
function naiveSolutions(w, h, markers) {
  const owner = new Int8Array(w * h).fill(-1);
  markers.forEach((m, mi) => { owner[m.r * w + m.c] = mi; });
  const N = w * h;
  const R0 = new Int8Array(N), C0 = new Int8Array(N), R1 = new Int8Array(N), C1 = new Int8Array(N);
  const perRegion = new Int8Array(N);
  const seen = new Uint8Array(N);
  const out = [];
  eachRectTiling(w, h, (lab) => {
    perRegion.fill(-1); seen.fill(0);
    let regions = 0, bad = false;
    for (let i = 0; i < N; i++) {
      const id = lab[i], r = (i / w) | 0, c = i % w;
      if (!seen[id]) {
        seen[id] = 1; regions++;
        R0[id] = r; C0[id] = c; R1[id] = r; C1[id] = c;
      } else {
        if (r < R0[id]) R0[id] = r;
        if (r > R1[id]) R1[id] = r;
        if (c < C0[id]) C0[id] = c;
        if (c > C1[id]) C1[id] = c;
      }
      if (owner[i] < 0) continue;
      if (perRegion[id] >= 0) { bad = true; break; }        // 一块吞了两个记号
      perRegion[id] = owner[i];
    }
    if (bad || regions !== markers.length) return;
    const sig = [];
    for (let id = 0; id < regions; id++) {
      if (perRegion[id] < 0) return;                        // 一块没有记号
      if (!aspectOk(C1[id] - C0[id] + 1, R1[id] - R0[id] + 1, markers[perRegion[id]].type)) return;
      sig.push(`${R0[id]},${C0[id]},${R1[id]},${C1[id]}#${perRegion[id]}`);
    }
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
      if (pointWindmill(lab, w, h, x, y)) return;
    }
    out.push(sig.sort().join(' '));
  });
  return out.sort();
}
{
  let boards = 0, disagree = 0, lostBirth = 0, emptyRef = 0;
  const sizes = [];
  for (let i = 0; i < 6; i++) {
    const b = sampleBoard(4, 4, 31 + i * 977);
    if (!b) continue;
    boards++;
    if (invalidReason(4, 4, b.markers, b.rects)) lostBirth++;
    const sol = [];
    const r = countAnchored(4, 4, b.markers, { onSolution: (s) => sol.push(signature(s)) });
    const N = naiveSolutions(4, 4, b.markers);
    sizes.push(N.length);
    if (N.length === 0) emptyRef++;
    eq(`4×4 seed=${i} 锚定式的 sols 等于朴素参照的解集大小`, r.sols, N.length);
    if (sol.sort().join('|') !== N.join('|')) {
      disagree++;
      console.log(`  分歧 seed=${i} 锚定 ${sol.length} 条 / 朴素 ${N.length} 条`);
    }
  }
  eq('出生盘（随机长出来的合法分块）逐张通过整盘检查', lostBirth, 0);
  eq('锚定式解集与朴素全枚举解集的分歧盘数', disagree, 0);
  eq('对照盘数', boards, 6);
  ok('参照不是"两边都数出 0"这种空对空', emptyRef === 0, `空参照盘 ${emptyRef} 张`);
  console.log(`  每张盘的解数（朴素全枚举给出）：${sizes.join(', ')}`);
}

// ============================================================ B2) 两套搜索比解集
console.log('\n== B2) 锚定式 vs MRV 精确覆盖式：比解集不只是比个数 ==');
// 两边都必须**枚举到底**（不带 limitSolutions）才能比集合：
// 两套搜索的分支顺序不同，截断前缀本来就该不一样。
for (const [w, h, n] of [[4, 4, 8], [5, 5, 8], [6, 6, 6], [7, 7, 5]]) {
  let boards = 0, disagree = 0, skipped = 0;
  for (let i = 0; i < n; i++) {
    const b = sampleBoard(w, h, w * 131 + h * 17 + i * 7919);
    if (!b) { skipped++; continue; }
    const A = [], C = [];
    const ra = countAnchored(w, h, b.markers, { nodeBudget: 2e6, onSolution: (s) => A.push(signature(s)) });
    const rc = countCover(w, h, b.markers, { nodeBudget: 2e6, onSolution: (s) => C.push(signature(s)) });
    if (ra.stopped || rc.stopped) { skipped++; continue; }
    boards++;
    eq(`${w}×${h} seed=${i} 两套的解数`, C.length, A.length);
    if (A.sort().join('|') !== C.sort().join('|')) {
      disagree++;
      console.log(`  ${w}×${h} seed=${i} 解集分歧（个数相同也算分歧）`);
    }
  }
  eq(`${w}×${h}：两套搜索的解集分歧盘数`, disagree, 0);
  ok(`${w}×${h}：至少对照了 3 张盘`, boards >= 3, `实际 ${boards}，跳过 ${skipped}`);
}

// ============================================================ A2) 每个解都合法
console.log('\n== A2) 数到的每一个解都过整盘复核 ==');
{
  let badSol = 0, checked = 0, total = 0, mismatch = 0, lostBirth = 0;
  for (let i = 0; i < 30; i++) {
    const w = 5 + (i % 3), h = 5 + ((i + 1) % 3);
    const b = sampleBoard(w, h, 500 + i * 7919);
    if (!b) { lostBirth++; continue; }
    if (invalidReason(w, h, b.markers, b.rects)) lostBirth++;
    let seen = 0;
    const r = countAnchored(w, h, b.markers, {
      nodeBudget: 300000,
      onSolution: (sol) => {
        seen++;
        if (invalidReason(w, h, b.markers, sol.map((p) => ({ r0: p.r0, c0: p.c0, r1: p.r1, c1: p.c1 })))) badSol++;
      },
    });
    if (!r.stopped && r.sols !== seen) mismatch++;
    checked++;
    total += seen;
  }
  eq('出生盘合法（≥1 解是真的）', lostBirth, 0);
  eq('计数器数到的解里有非法解的个数', badSol, 0);
  eq('onSolution 次数 == sols', mismatch, 0);
  ok('真的复核过上百个解（不是一条都没碰到）', total > 100, `共 ${total}`);
  eq('对照盘数', checked, 30);
}

// ============================================================ C) 唯一性证明与预算
console.log('\n== C) "数到 2 就停"的语义 + 手摆小例 ==');
{
  const twoBars = [{ r: 0, c: 0, type: T_WIDE }, { r: 1, c: 1, type: T_WIDE }];
  eq('2×2 两个 - 记号：唯一解（两条横块）', countAnchored(2, 2, twoBars).sols, 1);
  eq('同一张盘"数到 2"仍返回 1（= 全树已穷尽，这才是唯一性证明）',
    countAnchored(2, 2, twoBars, { limitSolutions: 2 }).sols, 1);
  eq('2×2 四个 1×1 全是 + ⇒ 中心四块共角，无解', countAnchored(2, 2,
    [{ r: 0, c: 0, type: T_SQUARE }, { r: 0, c: 1, type: T_SQUARE },
      { r: 1, c: 0, type: T_SQUARE }, { r: 1, c: 1, type: T_SQUARE }]).sols, 0);
  eq('把其中一个 + 换成 - 仍无解（1×1 只能配 +）', countAnchored(2, 2,
    [{ r: 0, c: 0, type: T_WIDE }, { r: 0, c: 1, type: T_SQUARE },
      { r: 1, c: 0, type: T_SQUARE }, { r: 1, c: 1, type: T_SQUARE }]).sols, 0);
  eq('2×2 两个 | 记号（竖块）也是唯一解', countAnchored(2, 2,
    [{ r: 0, c: 0, type: T_TALL }, { r: 1, c: 1, type: T_TALL }]).sols, 1);
  eq('2×2 里 - 与 | 混放：无解（横竖互斥）', countAnchored(2, 2,
    [{ r: 0, c: 0, type: T_WIDE }, { r: 1, c: 1, type: T_TALL }]).sols, 0);
}
{
  // 手算得出来的多解盘：1×5 横条，两个 '-' 记钉在两端 ⇒ 分界线可以在 1 或 2，
  // 也就是 {0,1}|{2,3,4} 与 {0,1,2}|{3,4} 两个解。1×n 上没有内点，禁四角永不触发。
  const strip = [{ r: 0, c: 0, type: T_WIDE }, { r: 0, c: 4, type: T_WIDE }];
  const all = countAnchored(5, 1, strip);
  const two = countAnchored(5, 1, strip, { limitSolutions: 2 });
  eq('1×5 两端各一个 -：恰好 2 个解', all.sols, 2);
  eq('与朴素全枚举一致', naiveSolutions(5, 1, strip).length, 2);
  eq('多解盘上"数到 2"立刻返回 2', two.sols, 2);
  ok('提前停省了节点', two.nodes < all.nodes, `${two.nodes} vs ${all.nodes}`);
  // 同一张盘加一个中间的 + ⇒ 三条区域要填满 5 格且中间那条必须是 1×1，两端仍各为宽条：唯一解
  eq('中间再钉一个 +（1×5 切成 -、+、-）：唯一解',
    countAnchored(5, 1, [{ r: 0, c: 0, type: T_WIDE }, { r: 0, c: 2, type: T_SQUARE },
      { r: 0, c: 4, type: T_WIDE }]).sols, 1);
}
{
  // 记号表本身是出题器与证明器的边界，越界/重叠都在这里挡掉
  let threw = 0;
  try { countAnchored(2, 2, [{ r: 0, c: 0, type: T_SQUARE }, { r: 5, c: 5, type: T_SQUARE }]); }
  catch { threw++; }
  try { countAnchored(2, 2, [{ r: 1, c: 1, type: T_SQUARE }, { r: 1, c: 1, type: T_WIDE }]); }
  catch { threw++; }
  try { countCover(2, 2, [{ r: 0, c: 0, type: T_SQUARE }, { r: 0, c: 0, type: T_WIDE }]); }
  catch { threw++; }
  eq('越界 / 重叠的记号表一定抛错（两套都抛）', threw, 3);
}
{
  const b = sampleBoard(6, 6, 77);
  const tight = countAnchored(6, 6, b.markers, { nodeBudget: 1 });
  eq('nodeBudget=1 一定击穿', tight.stopped, true);
  const loose = countAnchored(6, 6, b.markers);
  ok('击穿时 sols 只是下界', tight.sols <= loose.sols, `${tight.sols} ≤ ${loose.sols}`);
  ok('这张 6×6 盘多解，所以"下界"不是空话', loose.sols > 1, `sols=${loose.sols}`);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
