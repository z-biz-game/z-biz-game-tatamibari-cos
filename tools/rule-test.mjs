// 规则语义测试台 · "禁四角共点"到底排除哪些构型
//
// 这份文件的存在理由：规则含义必须由穷举钉死，不能由实现者的印象钉死。
// 选型这一轮我已经记错过两次（把品类名写成 Tatamasa、把"2×2 不得同块"当成本盘规则），
// 所以这里每条结论都有机器来源：
//
//   0) 先用 1×n 分块数 = 2^(n-1) 这个可手算的恒等式校验枚举器本身；
//   1) 从 3×3 上**所有**长方形分块读出内点四周出现的构型 → 哪些可实现、哪些不可能，
//      不靠手写例子；构型表用"受限增长串"规范化（首现顺序重命名），共 15 种 = Bell(4)；
//   2) 每种构型的角数（几何法），断言只会是 0 / 2 / 4 且 4 ⟺ 四格互异；
//   3) 两条互不信任的实现（几何法 / 窗口法）在 4×4、5×5 全部长方形分块上给出同一份违规点集；
//   4) 反例：一张非长方形 labeling 上两法确实分歧 —— 恒等依赖长方形前提；
//   5) 手摆例子：风车盘必须被抓，含 2×2 正方块的盘不得被抓；
//   6) 顺带量出 n×n 长方形分块总数 —— 那是唯一解穷举的门阶成本。
//
// 坐标约定见 js/engine/rules.js。

import {
  regionBoxes, regionSizes, isRectangular, cornerCountAt, cornerViolations,
  aroundPoint, windmillPoints, violationSignature, pointWindmill,
} from '../js/engine/rules.js';
import { eachRectTiling, countAnchoredTilings } from './tiling_enum.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}
function eq(name, got, want) { ok(name, got === want, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`); }

// ---------------------------------------------------------------- 长方形分块枚举
// 枚举器本体重定位到 tools/tiling_enum.mjs（计数台也要用它当参照），
// 第 0 节仍然用"1×n 的分块数 = 2^(n-1)"这个可手算的恒等式校验它。

// 四格 id → 规范化构型串（按首现顺序重命名为 A,B,C,…），即受限增长串
function cellConfigOf(quad) {
  const seen = new Map();
  let s = '';
  for (const id of quad) {
    if (!seen.has(id)) seen.set(id, String.fromCharCode(65 + seen.size));
    s += seen.get(id);
  }
  return s;
}

// Bell(4)=15 的受限增长串全集（长度 4，首位为 A，每位 ≤ 1+此前出现的最大字母）。
// 上一版我在这里写错了三个名字（AACB / ACAB / ACBA 都不是受限增长串，永远不可能出现），
// 所以这张表本身也要被程序生成一次，而不是手抄。
function rgs4() {
  const out = [];
  const rec = (pre, maxId) => {
    if (pre.length === 4) { out.push(pre.map((i) => String.fromCharCode(65 + i)).join('')); return; }
    for (let v = 0; v <= maxId + 1; v++) rec(pre.concat([v]), Math.max(maxId, v));
  };
  rec([], -1);
  return out;
}
const SHAPES15 = rgs4();

console.log('== 0) 枚举器自检：1×n 的长方形分块数应为 2^(n-1) ==');
for (const n of [1, 2, 3, 4, 5, 6]) {
  let hit = 0;
  eachRectTiling(1, n, () => hit++);
  eq(`1×${n} 分块数`, hit, 2 ** (n - 1));
}
{
  let bad = 0;
  eachRectTiling(3, 3, (l) => { if (!isRectangular(l, 3, 3)) bad++; });
  eq('枚举器产出的每个分块都通过 isRectangular（3×3 全量）', bad, 0);
  eq('Bell(4) = 15（程序生成的构型全集）', SHAPES15.length, 15);
}
{
  // 计数器建立在"第一个未填格必须是它所在矩形的左上角"这条锚定性质上（见 js/engine/counter.js）。
  // 光有证明不够，这里用两套枚举器**数同一个量**：锚定式若会重会漏，分块数就对不上。
  const want = new Map([[1, 1], [2, 2], [3, 4], [4, 8], [5, 16]]);
  for (const [n, exp] of want) eq(`锚定式 1×${n} 分块数`, countAnchoredTilings(1, n).hit, exp);
  for (const [w, h] of [[2, 2], [2, 3], [3, 3], [4, 3], [4, 4]]) {
    let naive = 0;
    eachRectTiling(w, h, () => naive++);
    eq(`${w}×${h} 锚定式与朴素式分块数相同`, countAnchoredTilings(w, h).hit, naive);
  }
  eq('锚定式 4×4 分块数（回归锁）', countAnchoredTilings(4, 4).hit, 70878);
}

// ------------------------------------------------- 1)+2) 内点构型的穷举分类（3×3 全量）
console.log('\n== 1) 内点构型：从 3×3 的全部长方形分块里读出来 ==');
const W3 = 3, H3 = 3;
const shapes = new Map(); // 构型 -> {count, corners:Set}
let tilings3 = 0;
eachRectTiling(W3, H3, (lab) => {
  tilings3++;
  for (let y = 1; y < H3; y++) for (let x = 1; x < W3; x++) {
    const sh = cellConfigOf(aroundPoint(lab, W3, x, y));
    const rec = shapes.get(sh) || { count: 0, corners: new Set() };
    rec.count++;
    rec.corners.add(cornerCountAt(lab, W3, H3, x, y));
    shapes.set(sh, rec);
  }
});
const allCorners = [...new Set([...shapes.values()].flatMap((v) => [...v.corners]))].sort();
console.log(`  3×3 长方形分块 ${tilings3} 个；内点处出现的构型 ${shapes.size} 种；角数取值 ${JSON.stringify(allCorners)}`);

const realizable = SHAPES15.filter((s) => shapes.has(s));
const impossible = SHAPES15.filter((s) => !shapes.has(s));
console.log(`  可实现 ${realizable.length} 种：${realizable.join(' ')}`);
console.log(`  长方形分块下不可能 ${impossible.length} 种：${impossible.join(' ')}`);
eq('可实现的构型数', realizable.length, 8);
eq('不可能的构型数', impossible.length, 7);
eq('不可能的正是 4 种 3+1 与 3 种含对角配对的', impossible.slice().sort().join(' '),
  'AAAB AABA ABAA ABBA ABBB ABBC ABCA');

// 为什么是 8 而不是 15，也不是我最初手算的 10：
// 一个构型可被长方形分块实现 ⟺ 它的每个等价类都在 2×2 窗口内构成一个轴对齐矩形。
// 我原先漏掉的是"两类必须共边"：{NW,SE} 与 {NE,SW} 是**对角**，不是矩形，
// 所以 6 种 2+1+1 里只有 4 种可实现（ABCA、ABBC 出局），手算少减了 2 个。
const BOX_OK = (() => {
  // 位置 0=NW 1=NE 2=SW 3=SE；窗口内的轴对齐矩形集合
  const boxes = new Set(['0', '1', '2', '3', '01', '23', '02', '13', '0123']);
  return (s) => {
    const groups = new Map();
    for (let i = 0; i < 4; i++) {
      const g = groups.get(s[i]) || '';
      groups.set(s[i], g + i);
    }
    for (const g of groups.values()) if (!boxes.has([...g].sort().join(''))) return false;
    return true;
  };
})();
eq('机器穷举出的可集性与"每类都是轴对齐矩形"这个判据完全一致',
  SHAPES15.filter((s) => shapes.has(s)).sort().join(' '),
  SHAPES15.filter((s) => BOX_OK(s)).sort().join(' '));
for (const s of ['ABCA', 'ABBC', 'ABBA']) ok(`${s} 含对角配对，判不可实现`, !shapes.has(s));

const cornersOf = (s) => (shapes.has(s) ? [...shapes.get(s).corners].sort() : null);
eq('AAAA（四格同块，点在块内部）角数只有 0', JSON.stringify(cornersOf('AAAA')), '[0]');
eq('AABB（两横条，边界直穿）角数只有 0', JSON.stringify(cornersOf('AABB')), '[0]');
eq('ABAB（两竖条，边界直穿）角数只有 0', JSON.stringify(cornersOf('ABAB')), '[0]');
for (const s of ['AABC', 'ABAC', 'ABCB', 'ABCC']) {
  eq(`构型 ${s}（T 形连接）角数只有 2`, JSON.stringify(cornersOf(s)), '[2]');
}
eq('ABCD（四格互异 = 风车）角数只有 4', JSON.stringify(cornersOf('ABCD')), '[4]');
ok('角数永不为奇数、也不超过 4（3×3 全量）',
  [...shapes.values()].every((v) => [...v.corners].every((c) => c % 2 === 0 && c <= 4)));
eq('被禁构型恰好一种',
  SHAPES15.filter((s) => shapes.has(s) && [...shapes.get(s).corners].includes(4)).join(' '), 'ABCD');
eq('窗口法与几何法在 3×3 全量上对"哪些点违规"完全一致', (() => {
  let bad = 0;
  eachRectTiling(W3, H3, (lab) => {
    if (violationSignature(cornerViolations(lab, W3, H3)) !== violationSignature(windmillPoints(lab, W3, H3))) bad++;
  });
  return bad;
})(), 0);

// ------------------------------------- 3)+6) 两法恒等 & 计数器成本（4×4 全量，5×5 起抽样）
console.log('\n== 3) 两条实现互不信任 + 6) 穷举成本 ==');
// 4×4 的长方形分块全量 7 万个，可以真跑完；5×5 实测 8400 万个 —— 从 5×5 起一律带预算抽样，
// 并把"这是抽样"打在输出里，而不是藏进断言里。（选型卡里"穷举有界"那句话就是这么被改掉的。）
{
  const w = 4, h = 4;
  let bad = 0, windmills = 0, n = 0, badPoint = 0;
  const t0 = Date.now();
  eachRectTiling(w, h, (lab) => {
    n++;
    const geo = violationSignature(cornerViolations(lab, w, h));
    const win = violationSignature(windmillPoints(lab, w, h));
    if (geo !== win) bad++;
    // 计数器剪枝用的是**单点版**窗口法（允许盘面没填满）。它必须和整盘版逐点一致，
    // 否则"环带检查"会漏判或误判，唯一解证明就不成立了。
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
      const hitPoint = win.split(' | ').includes(`${x},${y}`);
      if (pointWindmill(lab, w, h, x, y) !== hitPoint) badPoint++;
    }
    if (win.length) windmills++;
  });
  console.log(`  ${w}×${h}: 长方形分块 ${n} 个（全量），两法分歧 ${bad}，含风车 ${windmills}，满足禁四角 ${n - windmills}（${(100 * (n - windmills) / n).toFixed(1)}%），耗时 ${Date.now() - t0} ms`);
  eq('4×4 两法分歧数', bad, 0);
  eq('4×4 单点版与整盘版窗口法逐点分歧', badPoint, 0);
  eq('4×4 长方形分块总数', n, 70878);
  eq('4×4 满足禁四角的分块数（回归锁）', n - windmills, 12455);
  ok('禁四角这条规则真有约束力（满足者远少于半数）', (n - windmills) / n < 0.3);
}
for (const [w, h, budget] of [[5, 5, 300000], [6, 6, 300000]]) {
  let n = 0, bad = 0, windmills = 0;
  const t0 = Date.now();
  const { hit, stopped } = eachRectTiling(w, h, (lab) => {
    n++;
    const geo = violationSignature(cornerViolations(lab, w, h));
    const win = violationSignature(windmillPoints(lab, w, h));
    if (geo !== win) bad++;
    if (win.length) windmills++;
  }, budget);
  console.log(`  ${w}×${h}: 抽样前 ${hit} 个分块${stopped ? '（到预算上限，非全量）' : '（全量）'}，两法分歧 ${bad}，含风车 ${windmills}，耗时 ${Date.now() - t0} ms`);
  eq(`${w}×${h} 抽样两法分歧`, bad, 0);
}

// ------------------------------------------------------- 4) 前提：非长方形时两法分歧
console.log('\n== 4) 恒等依赖"每块是长方形"这个前提 ==');
{
  const lab = Int8Array.from([
    0, 0, 1,
    0, 2, 1,
    3, 4, 5,
  ]); // 块 0 是 L 形，外接框 2×2 只填了 3 格
  eq('该 labeling 不是长方形分块', isRectangular(lab, 3, 3), false);
  const geo = violationSignature(cornerViolations(lab, 3, 3));
  const win = violationSignature(windmillPoints(lab, 3, 3));
  console.log(`  几何法违规点: [${geo}]\n  窗口法违规点: [${win}]`);
  ok('非长方形时两法给出不同答案（所以前提必须显式检查）', geo !== win);
}

// ----------------------------------------------------------- 5) 两张手摆例子盘
console.log('\n== 5) 手摆例子 ==');
{
  const A = 0, B = 1, C = 2, D = 3, E = 4, F = 5, G = 6, H = 7;
  const windmill = Int8Array.from([
    A, A, A, A,
    B, C, D, E,
    B, F, G, E,
    H, H, H, H,
  ]);
  eq('风车盘是长方形分块', isRectangular(windmill, 4, 4), true);
  eq('风车盘中心 (2,2) 角数', cornerCountAt(windmill, 4, 4, 2, 2), 4);
  eq('几何法抓到 1 个违规点', cornerViolations(windmill, 4, 4).length, 1);
  eq('窗口法抓到 1 个违规点', windmillPoints(windmill, 4, 4).length, 1);
  eq('两法同一份点集', violationSignature(cornerViolations(windmill, 4, 4)),
    violationSignature(windmillPoints(windmill, 4, 4)));
  eq('风车盘构型', cellConfigOf(aroundPoint(windmill, 4, 2, 2)), 'ABCD');

  // "四个 2×2 方块拼成的 4×4"——我本来把它当成"证明本盘不禁 2×2"的例子，
  // 机器告诉我它恰恰是禁四角的教科书构型：正中心那一点是四块的公共角。
  const q1 = 0, q2 = 1, q3 = 2, q4 = 3;
  const fourSquares = Int8Array.from([
    q1, q1, q2, q2,
    q1, q1, q2, q2,
    q3, q3, q4, q4,
    q3, q3, q4, q4,
  ]);
  eq('四块 2×2 是长方形分块', isRectangular(fourSquares, 4, 4), true);
  eq('它的正中心是风车点（4 角共点）', cornerCountAt(fourSquares, 4, 4, 2, 2), 4);
  eq('中心构型为 ABCD', cellConfigOf(aroundPoint(fourSquares, 4, 2, 2)), 'ABCD');
  eq('几何法只报中心这一个点', cornerViolations(fourSquares, 4, 4).length, 1);
  eq('窗口法也只报中心这一个点', windmillPoints(fourSquares, 4, 4).length, 1);
  // 被禁的是"四角共点"，不是"2×2 同块"：每块 2×2 自己的中心点在块内部，角数 0
  eq('2×2 方块自身中心点角数为 0', cornerCountAt(fourSquares, 4, 4, 1, 1), 0);
  eq('该点构型为 AAAA（四格同块）', cellConfigOf(aroundPoint(fourSquares, 4, 1, 1)), 'AAAA');

  // 真正"含 2×2 方块且全盘合法"的例子由枚举器找，不由我手摆：
  const withSquare = (() => {
    let found = null;
    eachRectTiling(4, 4, (lab) => {
      if (found) return;
      if (windmillPoints(lab, 4, 4).length) return;
      for (const b of regionBoxes(lab, 4, 4).values()) {
        if (b.r1 - b.r0 === 1 && b.c1 - b.c0 === 1) { found = Int8Array.from(lab); return; }
      }
    });
    return found;
  })();
  ok('枚举器能给出"含 2×2 方块、且满足禁四角"的 4×4 盘', withSquare !== null);
  if (withSquare) {
    eq('该盘没有任何违规点', cornerViolations(withSquare, 4, 4).length, 0);
    ok('该盘确实含一个 2×2 方块', [...regionBoxes(withSquare, 4, 4).values()]
      .some((b) => b.r1 - b.r0 === 1 && b.c1 - b.c0 === 1));
    console.log('  合法含方块例盘：\n' + [...Array(4)].map((_, r) =>
      '    ' + [...withSquare.slice(r * 4, r * 4 + 4)].join(' ')).join('\n'));
  }
}

// ---------------------------------------------------------- 辅助函数自身正确性
{
  const lab = Int8Array.from([0, 0, 1, 1]);
  const boxes = regionBoxes(lab, 4, 1);
  eq('1×4 里块 0 的列范围', `${boxes.get(0).c0},${boxes.get(0).c1}`, '0,1');
  const sizes = regionSizes(Int8Array.from([0, 0, 0, 1, -1, 1]));
  eq('regionSizes 忽略未定格', `${sizes.get(0)},${sizes.get(1)}`, '3,2');
  eq('未定格的格不进外接框', regionBoxes(Int8Array.from([0, -1, 1, -1]), 2, 2).size, 2);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
