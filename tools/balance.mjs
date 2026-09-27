// 难度实测台 · 畳バリ
//
// 这台机器**读**难度的读数，不**设**难度。`js/engine/generate.js` 里 TIERS[].band 与 TIERS[].budgetMs
// 的数字必须来自本文件打印的分位表（`MEASURE=1 node tools/balance.mjs`）：改一条规则权重、
// 改一次剪枝口径、引擎加一条规则，这些数字就得重抄；不重抄会被阶梯与命中率门禁打红。
//
// 判据只有实的没有虚的：
//   1. 出货盘 100% 铅笔推得完（拿盘重跑，不读生成器的账）
//   2. 出货盘 100% 被计数器在节点预算内证唯一（硬闸，确定性量）；墙钟那条判的是复核尾巴
//      p95 ≤ TIERS[].budgetMs × HEADROOM，单次离群只作读数——理由见下面 HEADROOM 那段
//   3. 剪完之后每条记号都不冗余：逐个试删，删完必须"推不完 / 不唯一 / 超预算 / 解过不了结构下限"，打 X/N
//   4. 复解一致 + 分数是盘的属性（同一组记号换三条路径进来必须同分）
//   5. 中位分数严格递增；band 命中率 ≥ 90%
//   6. "出不起货"这个结论每轮重量一遍：抽得出且抽数在出货上限内 → 红
// 墙钟只作读数不作判定（同一台机器两次读数能差 3 倍），所以每个时间数字都写成 "<数字> ms"，
// 可复现自证把这类 token 归一化成 "T ms" 之后逐字节 diff——**条数与判定一个都不许差**。
//
//   node tools/balance.mjs                  门禁模式（红就 exit 1）
//   MEASURE=1 node tools/balance.mjs        量测模式：打印尺寸×密度分位表 + band/budgetMs 建议
//   SAMPLES=24 node tools/balance.mjs       改每档抽样局数（band 与 budgetMs 都按这个样本回填）
//
// 回填 TIERS[] 的次序（band 与 budgetMs 互相影响，不许一次跑完就抄）：
//   1. budgetMs —— 先把预算摘掉：
//      `MEASURE=1 SAMPLES=40 GRID=1 BIG_DRAWS=1 MEASURE_BUDGET_MS=Infinity node tools/balance.mjs`
//      带旧预算跑会把击穿的盘记成"预算内没证完"的拒收，抽数与分数分布都被污染。
//   2. band —— 再按出货口径量：`MEASURE=1 SAMPLES=24 node tools/balance.mjs`
//      这时预算已经是交付那套旋钮，量出来的 band 才对得上门禁那一跑。
//   3. 出货上限 tries —— 看第 2 步那一段的"每局平均试错 … max"，外扩一档取整；
//      再用 `MEASURE_BUDGET_MS=Infinity SAMPLES=40` 那一跑确认尾巴没被预算截断。
//   4. `node tools/balance.mjs`（默认 SAMPLES=12 是那 24 局的子集，命中率必为 100%），
//      然后 `SAMPLES=40` 再跑一遍：多出的 16 局是 band 没见过的新盘，band 泛不泛用就看那一行。

import { performance } from 'node:perf_hooks';
import { loadavg } from 'node:os';
import {
  ROUND_WEIGHT, RULE_WEIGHT, TIERS, UNSHIPPABLE, generate, generateOn, inspectBoard,
  markerGrid, plantedBoard, proveUnique, shuffled, structureOk,
} from '../js/engine/generate.js';
import { solve } from '../js/engine/pencil.js';
import { countAnchored, countCover, MARKER_CHAR } from '../js/engine/counter.js';
import { markersFromTiling, mulberry32, quantile } from './tiling_enum.mjs';
import { invalidReason, signature } from './reference.mjs';

const MEASURE = process.env.MEASURE === '1';
const N = Number(process.env.SAMPLES || 12);
/** band 是**选取**目标：一局不走运不该红，一档悄悄搬家必须红。 */
const HIT_GATE = 0.9;
/** 出货上限：一张盘平均抽多少次以内算"养得起"。等于 TIERS[] 里最大的那个 tries。 */
const DRAW_CEIL = Math.max(...TIERS.map((t) => t.tries));
/**
 * 【墙钟闸判 p95，不判单次 max】HEADROOM 与兄弟仓同一条口径
 * （battleship/tools/balance.mjs:18、suguru 同式）：判的是**整段分布的尾巴**相对实测基线的倍数。
 * 这一条是本轮实测逼出来的，不是顺手放松：本机 load 34–37 时连跑 5 次 SAMPLES=24 → 3 红 2 绿，
 * 红全是同一个形状（中等档 p95 0.02 ms 纹丝不动、单次 max 0.44 ms 对 0.26 ms 预算），
 * 每一次红的都是**一次亚毫秒调用赶上一次抢占**。判 max 量到的是调度器，不是引擎；
 * 更糟的是旧文案写着「按打印的建议值重抄 budgetMs」，那等于举着牌子领着一个 agent 去改 want 凑输出。
 * 判 p95 两条都保住：引擎真变慢会把整段抬起来（一定红），邻居挤一下只动离群点（不红，
 * 而 max 照样打印在行里，人看得见）。节点闸一个字没动——那是确定性的，负载压不着它。
 * HEADROOM=0 把闸贴回基线本身，留作可达性探针：只要那一段真跑过，p95 必然 > 0，于是必红。
 */
const HEADROOM = Number(process.env.HEADROOM ?? 2);
/** 邻居有多挤：墙钟读数的上下文，不参与任何判定。 */
const LOAD1 = loadavg()[0].toFixed(1);

let red = 0;
const fail = (msg) => { red++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—');
const sorted = (xs) => xs.slice().sort((a, b) => a - b);
const q = (xs, p) => quantile(sorted(xs), p);
/** 规则分布的规范化串：只看"每条规则出场几次"，与 facts 的插入顺序无关。 */
const ruleKey = (use) => Object.entries(use).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([k, v]) => `${k}=${v}`).join(' | ');

function quantLine(label, xs) {
  if (!xs.length) { console.log(`      ${label} 无样本`); return; }
  const s = sorted(xs);
  const at = (p) => String(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]).padStart(6);
  console.log(`      ${label.padEnd(7)} min ${at(0)}  p25 ${at(.25)}  中位 ${at(.5)}  p75 ${at(.75)}  p90 ${at(.9)}  max ${at(1)}`);
}

/**
 * 预热：冷启动的第一次 countAnchored/solve 带 JIT，实测能把 0.05 ms 量级的证明报成 >1 ms。
 * 拿它去定 budgetMs 会把预算抬到失真（那一次冷 JIT 就是一根 max 离群点，正是 HEADROOM 那段
 * 拒绝拿来定罪的东西），所以先把编译器热透再量。
 * 这一段不产出任何判定，纯读数。
 */
function warmUp() {
  const rnd = mulberry32(11);
  for (const [w, h] of [[4, 4], [6, 6]]) {
    for (let i = 0; i < 40; i++) {
      const p = plantedBoard(w, h, rnd, { minRegions: 2, maxBlockCells: w * h });
      if (p.reject) continue;
      solve(w, h, p.markers);
      countAnchored(w, h, p.markers, { limitSolutions: 2, nodeBudget: 1000 });
    }
  }
}
warmUp();

// ============================================================ 〇、尺寸 × 密度 分位表
if (MEASURE) {
  console.log(`\n== 量测表：同一套代码跑"尺寸 × 密度"的分数分位（每格 ${Number(process.env.GRID || 8)} 局），阶梯与 band 的唯一来源 ==`);
  const GRID = Number(process.env.GRID || 8);
  // 只量**出货表里有的**尺寸：大尺寸的抽不出货由第八节按结构下限单独定价，不占这张表。
  const SIZES = TIERS.map((t) => [t.size[0], t.size[1], t.struct.minRegions, t.struct.maxBlockCells]);
  const DENS = [0, 0.5, 0.85];
  for (const [w, h, minRegions, maxBlockCells] of SIZES) {
    for (const density of DENS) {
      const cfg = {
        key: `g${w}x${h}d${density}`, size: [w, h], density, rolls: 4, budgetMs: 50, tries: 40000,
        struct: { minRegions, maxBlockCells },
      };
      const scores = [], marks = [], draws = [], blk = [];
      let miss = 0;
      const t0 = performance.now();
      for (let s = 0; s < GRID; s++) {
        const g = generateOn(`grid|${w}${h}|${density}|${s}`, cfg);
        if (!g) { miss++; continue; }
        scores.push(g.score); marks.push(g.markers.length); draws.push(g.draws); blk.push(g.maxBlock);
      }
      console.log(`  ${w}×${h} 密度 ${density}：出货 ${GRID - miss}/${GRID} 分数 ${quantile(sorted(scores), 0)}/${quantile(sorted(scores), .5)}/${quantile(sorted(scores), 1)}（min/中位/max）` +
        ` 记号 ${q(marks, .5)} 最大块 ${q(blk, .5)} 抽 中位 ${q(draws, .5)} max ${q(draws, 1)} 墙钟 ${((performance.now() - t0) / GRID).toFixed(0)} ms/局`);
    }
  }
}

// ============================================================ 一、每档抽样
const rows = [];
// 默认就按**出货口径**（TIERS[].budgetMs）跑：band 要回填的是交付出去那套旋钮下的分布。
// 只有第一轮量 budgetMs 本身时才用 MEASURE_BUDGET_MS=Infinity 把预算摘掉——
// 否则击穿的盘会被记成"预算内没证完"的拒收，抽数与分数分布都被污染（budgetMs 的来源见
// js/engine/generate.js 的 TIERS 注释：40 局/档的尾巴探针，不是这一段）。
const genOpts = process.env.MEASURE_BUDGET_MS ? { budgetMs: Number(process.env.MEASURE_BUDGET_MS) } : {};
console.log(`\n== 出货与难度读数（每档 ${N} 局，seed 串固定 balance|<档>|<局>；本段预算 ${genOpts.budgetMs !== undefined ? `${genOpts.budgetMs} ms（MEASURE_BUDGET_MS 覆盖）` : '出货口径 TIERS[].budgetMs'}）==`);
for (let t = 0; t < TIERS.length; t++) {
  const tier = TIERS[t];
  const [w, h] = tier.size;
  const t0 = performance.now();
  const boards = [];
  const rejects = {};
  let refused = 0;
  for (let s = 0; s < N; s++) {
    const g = generate(`balance|${t}|${s}`, t, genOpts);
    if (!g) { refused++; continue; }
    boards.push(g);
    for (const [k, v] of Object.entries(g.reject)) if (v) rejects[k] = (rejects[k] || 0) + v;
  }
  const draws = boards.map((g) => g.draws);
  const scores = boards.map((g) => g.score);
  let inBand = tier.band ? boards.filter((g) => g.score >= tier.band[0] && g.score <= tier.band[1]).length : 0;
  const ruleTotals = {};
  for (const g of boards) for (const [k, v] of Object.entries(g.ruleUse)) ruleTotals[k] = (ruleTotals[k] || 0) + v;
  const heavy = ['R2 窗口构型表', 'R3 区域尺寸推理', 'R4 定形封闭', 'R6 候选形状收敛'].filter((k) => (ruleTotals[k] || 0) > 0);

  console.log(`\n${tier.name} ${tier.key} ${w}×${h} · 密度下限 ${tier.density} · 结构下限[${tier.struct.minRegions}块,最大块<=${tier.struct.maxBlockCells}] · 一铺 ${tier.rolls} 次记号 · tries ${tier.tries} · band ${tier.band ? `${tier.band[0]}–${tier.band[1]}` : '未回填'} · budgetMs ${tier.budgetMs}`);
  console.log(`      出货 ${boards.length}/${N} = ${pct(boards.length, N)}（${refused} 局 tries 内抽不出），命中 band ${inBand}/${boards.length} = ${pct(inBand, boards.length)}`);
  console.log(`      拒收原因合计：${Object.entries(rejects).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}`);
  console.log(`      每局平均试错：均值 ${(draws.reduce((a, b) => a + b, 0) / Math.max(1, boards.length)).toFixed(1)} 抽，中位 ${q(draws, .5)}，p95 ${q(draws, .95)}，max ${q(draws, 1)}（上限 ${tier.tries}）；种分块 中位 ${q(boards.map((g) => g.tilings), .5)} 张`);
  quantLine('分数', scores);
  quantLine('记号数', boards.map((g) => g.markers.length));
  quantLine('原盘块数', boards.map((g) => g.plantedMarkers));
  quantLine('铅笔步数', boards.map((g) => g.steps));
  quantLine('铅笔轮数', boards.map((g) => g.passes));
  quantLine('最大块', boards.map((g) => g.maxBlock));
  quantLine('剪枝删', boards.map((g) => g.pruneDeleted));
  console.log(`      规则出场（${boards.length} 局合计）：${Object.entries(ruleTotals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '无'}`);
  console.log(`      剪枝：试删 ${(boards.reduce((a, g) => a + g.pruneTrials, 0) / Math.max(1, boards.length)).toFixed(1)} 次/局，结构判据挡下 ${(boards.reduce((a, g) => a + g.pruneStructure, 0) / Math.max(1, boards.length)).toFixed(1)} 次/局`);
  const cNodes = boards.map((g) => g.counter.nodes);
  const cMs = boards.map((g) => g.counter.ms);
  // budgetMs 要盖过的是**这一局里发生过的每一次计数器调用**（种盘证一遍、每次试删一遍、出货盘再证一遍），
  // 不是只有出货那一次——所以取 g.proofMs（生成器自己记的尾巴），出货那次一并打印作对照。
  const pMs = boards.map((g) => g.proofMs);
  const suggest = Math.max(q(pMs, .95) * 4, Math.max(0, ...pMs) * 2);
  const overMsCalls = boards.reduce((a, g) => a + g.slowMs, 0);
  const overNodes = boards.reduce((a, g) => a + g.overNodes, 0);
  const notUniq = boards.filter((g) => !g.counter.proved).length;
  const msCeil = tier.budgetMs * HEADROOM;
  console.log(`      计数器（生成时那一次）：证到唯一 ${boards.length - notUniq}/${boards.length}，节点没证完 ${overNodes} 次，击穿墙钟预算 ${overMsCalls} 次，节点 中位 ${q(cNodes, .5)} p95 ${q(cNodes, .95)} max ${q(cNodes, 1)}`);
  console.log(`      墙钟（只作读数）：本档 ${(performance.now() - t0).toFixed(0)} ms，${((performance.now() - t0) / Math.max(1, N)).toFixed(1)} ms/局；出货盘证明 max ${Math.max(0, ...cMs).toFixed(2)} ms，全调用尾巴 p95 ${q(pMs, .95).toFixed(2)} max ${Math.max(0, ...pMs).toFixed(2)} ms ⇒ 建议 budgetMs = ${suggest.toFixed(2)} ms（当前 ${tier.budgetMs} ms；判定线 p95 ≤ 基线×${HEADROOM} = ${msCeil.toFixed(2)} ms；本机 load1 ${LOAD1}）`);

  if (boards.length !== N) fail(`${tier.name} 出货 ${boards.length}/${N}：tries=${tier.tries} 内抽不满，这一档出不起货，档位表要收缩`);
  if (q(draws, 1) > tier.tries) fail(`${tier.name} 抽数越过 tries 上限`);
  if (overNodes) fail(`${tier.name} 有 ${overNodes} 次证明在 nodeBudget=3e6 内没数完：节点预算得重抄`);
  // 出货那一次的击穿由第四段判（那才是交付出去要复算的那一次）；
  // 这一段管的是**全调用尾巴**：判 p95 对基线×HEADROOM，不判单次 max——理由写在文件头 HEADROOM 那段。
  // overMsCalls 照旧打印，但只作读数：它是「多少局里至少有一次调用抖过了 budgetMs」，
  // 在 load 37 的机器上它天生非零，拿它定罪就是在向调度器要承诺。
  // 门禁模式才判——量测模式正是用来重抄这些数字的那一遍。
  if (!MEASURE && q(pMs, .95) > msCeil) {
    fail(`${tier.name} 生成途中的证明尾巴 p95 ${q(pMs, .95).toFixed(2)} ms 盖过 budgetMs=${tier.budgetMs} 的 ${HEADROOM} 倍（判定线 ${msCeil.toFixed(2)} ms）：整段分布都在搬家，这是引擎慢了，按上面打印的建议值重抄`);
  }
  const sScores = sorted(scores);
  if (MEASURE) {
    console.log(`      band 建议（实测 min/max 外扩 5%）：[${Math.floor(sScores[0] * 0.95)}, ${Math.ceil(sScores[sScores.length - 1] * 1.05)}]`);
  } else if (!tier.band) {
    fail(`${tier.name} 的 band 还没回填（MEASURE=1 跑一遍，把建议值抄进 TIERS）`);
  } else if (boards.length && inBand / boards.length < HIT_GATE) {
    fail(`${tier.name} 命中 band ${inBand}/${boards.length} = ${pct(inBand, boards.length)} < 门禁 ${pct(HIT_GATE, 1)}：band 与实测脱节`);
  }
  rows.push({ tier, t, boards, scores: sScores, ruleTotals, heavy, cNodes });
}

// ============================================================ 二、阶梯 + 规则构成
console.log('\n== 阶梯：中位分数必须严格递增（档数按实测收缩，不许为了凑五档放松推完判据）==');
{
  let prev = -Infinity;
  let mono = true;
  for (const r of rows) {
    const med = r.scores.length ? quantile(r.scores, .5) : NaN;
    const up = Number.isFinite(med) && med > prev;
    if (!up) mono = false;
    console.log(`  ${up ? '✓' : '✗'} ${r.tier.name} ${r.tier.size.join('×')} 中位 ${med.toFixed(1)}  区间 ${r.scores[0]}..${r.scores[r.scores.length - 1]}  band ${r.tier.band ? `${r.tier.band[0]}–${r.tier.band[1]}` : '未回填'}  局数 ${r.scores.length}`);
    prev = med;
  }
  if (!MEASURE && !mono) fail('中位分数没有严格递增：要么某一档偷偷搬家，要么 band 需要重测');
  for (const r of rows) {
    const distinct = Object.keys(r.ruleTotals).length;
    console.log(`  ${r.heavy.length && distinct >= 3 ? '✓' : '✗'} ${r.tier.name} 规则种类 ${distinct} 条，重规则在场：${r.heavy.join(' ') || '无'}`);
    if (r.boards.length && (!r.heavy.length || distinct < 3)) {
      fail(`${r.tier.name} 的规则构成太薄（重规则 ${r.heavy.length ? r.heavy.join('/') : '无'}，种类 ${distinct}）：分数没在量推理，只剩盘大小`);
    }
  }
}

// ============================================================ 三、承诺一：铅笔推得完
console.log('\n== 承诺一：出货盘必须 100% 被铅笔通道从空盘推完（拿盘重跑，不读生成器的账）==');
for (const r of rows) {
  let done = 0, stalled = 0;
  const left = [];
  for (const g of r.boards) {
    const run = solve(g.w, g.h, g.markers);
    if (run.solved) done++;
    else { stalled++; left.push(run.unknownEdges); }
  }
  console.log(`  ${stalled ? '✗' : '✓'} ${r.tier.name}：${done}/${r.boards.length} 局推完、全程不回溯${left.length ? `（卡住的盘剩未知边 ${left.join('/')}）` : ''}`);
  if (stalled) fail(`${r.tier.name} 有 ${stalled} 张出货盘推不完`);
}

// ============================================================ 四、承诺二：计数器在预算内证唯一
console.log('\n== 承诺二：出货盘必须 100% 被穷举计数器（limitSolutions:2）在节点预算内证唯一；墙钟判的是复核尾巴 p95 ≤ 基线×HEADROOM，单次离群只作读数 ==');
for (const r of rows) {
  let uniq = 0, slow = 0, stopped = 0, notUniq = 0, worstNodes = 0;
  const msList = [];
  for (const g of r.boards) {
    const c = countAnchored(g.w, g.h, g.markers, { limitSolutions: 2, nodeBudget: 3e6 });
    msList.push(c.ms);
    worstNodes = Math.max(worstNodes, c.nodes);
    if (c.stopped) stopped++;
    // slow 是读数：多少局的**单次**复核抖过了基线。邻居压一下它就非零，定罪得看整段。
    else if (c.ms > r.tier.budgetMs) slow++;
    if (c.sols === 1 && !c.stopped) uniq++; else notUniq++;
  }
  const msCeil = r.tier.budgetMs * HEADROOM;
  const tail = q(msList, .95);
  console.log(`  ${stopped || notUniq || tail > msCeil ? '✗' : '✓'} ${r.tier.name}：唯一 ${uniq}/${r.boards.length} · 单次击穿基线 ${slow}（读数） · 节点没证完 ${stopped} · 没证到唯一 ${notUniq} · 节点 max ${worstNodes} · 复核墙钟 p95 ${tail.toFixed(2)} max ${Math.max(0, ...msList).toFixed(2)} ms（基线 ${r.tier.budgetMs} ms，判定线 ${msCeil.toFixed(2)} ms，load1 ${LOAD1}）`);
  // 判 p95 不判 max：见文件头 HEADROOM 那段（本机 load 34–37 连跑 5 次，3 红全是一次抢占、p95 纹丝不动）。
  // MEASURE 模式不判——那一跑正是用来重抄基线的那一遍，与第一段同进同退。
  if (!MEASURE && tail > msCeil) fail(`${r.tier.name} 复核尾巴 p95 ${tail.toFixed(2)} ms 盖过基线 ${r.tier.budgetMs} ms 的 ${HEADROOM} 倍（判定线 ${msCeil.toFixed(2)} ms，其间 ${slow}/${r.boards.length} 局单次击穿）：整段都在搬家，这一档的复核普遍变慢了`);
  if (stopped) fail(`${r.tier.name} 有 ${stopped} 局复核在 nodeBudget=3e6 内没数完`);
  if (notUniq) fail(`${r.tier.name} 有 ${notUniq} 局计数器没证到唯一 —— "推得完 ⟹ 解唯一" 被打破，引擎有 bug`);
}

// ============================================================ 四b、第二套穷举实现逐盘对答案
// 承诺二那一段跑的是 countAnchored（锚定性质：每层放"当前最靠前的空格"所属的那块）。
// 出货不能只靠它自己再说一遍——所以要拿**另一种搜索**再数一次：countCover 不假设锚定性质，
// 每个记号先枚举它能落在的任何位置的矩形，再按"候选最少的未覆盖格"（MRV）分支，覆盖用
// BigInt 位掩码管。两套只共享规则语义，不共享搜索。
// 这一段的存在理由：两套的解数一致而**解集**不同，是"数到 2 就停"这类口径 bug 唯一的显形方式，
// 而只比 sols 数字比不出来。counter-test 那套对照跑的是 sampleBoard 的盘；这里跑的是
// 本轮**真的出货**的每一张——浏览器里玩家拿到的就是这些盘。
console.log('\n== 承诺二之续：出货的每一盘都要被第二套穷举实现（countCover · MRV + BigInt 位掩码）再数一遍，且解集逐块相同 ==');
for (const r of rows) {
  let agree = 0, setDiff = 0, countDiff = 0, stopped = 0;
  let worstNodes = 0;
  const detail = [];
  for (const g of r.boards) {
    const A = [], C = [];
    const a = countAnchored(g.w, g.h, g.markers, { limitSolutions: 2, nodeBudget: 3e6, onSolution: (s) => A.push(signature(s)) });
    const c = countCover(g.w, g.h, g.markers, { limitSolutions: 2, nodeBudget: 3e6, onSolution: (s) => C.push(signature(s)) });
    worstNodes = Math.max(worstNodes, c.nodes);
    if (a.stopped || c.stopped) { stopped++; detail.push(`${g.seed} 没数完（anchored ${a.stopped} / cover ${c.stopped}）`); continue; }
    // 解集比对只在两边都数到底时成立；a.sols>1 的盘上面那段已经判过红，这里不重复定罪，
    // 但"截断前缀本来就该不一样"（counter-test 那句话）意味着不能拿 limit 之后的前缀比集合。
    if (a.sols !== c.sols) { countDiff++; detail.push(`${g.seed} 解数分歧 anchored=${a.sols} cover=${c.sols}`); continue; }
    if (a.sols === 1 && A.sort().join('|') !== C.sort().join('|')) {
      setDiff++; detail.push(`${g.seed} 解集分歧 anchored=[${A.join('|')}] cover=[${C.join('|')}]`);
      continue;
    }
    agree++;
  }
  console.log(`  ${setDiff || countDiff || stopped ? '✗' : '✓'} ${r.tier.name}：两套逐块一致 ${agree}/${r.boards.length} · 解数分歧 ${countDiff} · 解集分歧 ${setDiff} · 没数完 ${stopped} · cover 节点 max ${worstNodes}`);
  if (stopped) fail(`${r.tier.name} 有 ${stopped} 盘第二套穷举在 nodeBudget=3e6 内没数完 —— 没数完就等于没复核`);
  if (countDiff) fail(`${r.tier.name} 有 ${countDiff} 盘两套穷举解数不同：${detail[0]}`);
  if (setDiff) fail(`${r.tier.name} 有 ${setDiff} 盘两套穷举解集不同（数字相同也算分歧）：${detail[0]}`);
}

// ============================================================ 五、剪完之后每条记号都不冗余
const MIN_CHECK = Math.min(4, N);
console.log(`\n== 极小性：每档抽 ${MIN_CHECK} 局，逐个记号试删；删完仍能满足**出货三判据**（推得完 ∧ 预算内唯一 ∧ 解过结构下限）的就是冗余记号 ==`);
{
  // 判据与 pruneMarkers 的删除判据**逐字对齐**：一处试删只有在这一条删除本来就该被采纳却没被采纳时
  // 才算冗余。用"推得完 ∧ 唯一"这套更宽的口径去检是不成立的——2 记号的盘删到 1 记号时
  // 唯一解就是整盘一块，计数器照样 sols=1（一块=一记号，没有别的切法），铅笔也推得完，
  // 但那种"题"不满足结构下限，生成器从未承诺要采纳它。
  let kept = 0, redundant = 0, boardsChecked = 0;
  const blocked = { 推不完: 0, 不唯一: 0, 超预算: 0, 结构不过: 0 };
  for (const r of rows) {
    let okN = 0, badN = 0;
    for (const g of r.boards.slice(0, MIN_CHECK)) {
      boardsChecked++;
      for (let i = 0; i < g.markers.length; i++) {
        const cand = g.markers.slice(0, i).concat(g.markers.slice(i + 1));
        const run = solve(g.w, g.h, cand);
        if (!run.solved) { blocked.推不完++; okN++; continue; }
        const c = proveUnique(g.w, g.h, cand, { budgetMs: r.tier.budgetMs, nodeBudget: 3e6 });
        if (!c.proved) { blocked[c.overBudget ? '超预算' : '不唯一']++; okN++; continue; }
        if (c.blocks && !structureOk(c.blocks, r.tier.struct)) { blocked.结构不过++; okN++; continue; }
        badN++; redundant++;
        fail(`${r.tier.name} 有冗余记号：删掉第 ${i} 条（\`${MARKER_CHAR[g.markers[i].type]}\` @ ${g.markers[i].r},${g.markers[i].c}）仍满足全部出货判据`);
      }
    }
    kept += okN;
    console.log(`  ${badN ? '✗' : '✓'} ${r.tier.name}：${okN + badN} 次试删，${okN} 次删完即出局（记号数 ${r.boards.slice(0, MIN_CHECK).map((g) => g.markers.length).join('/')}）`);
  }
  console.log(`  X/N：${kept}/${kept + redundant} —— 盘 ${boardsChecked} 张；挡下原因 推不完 ${blocked.推不完} · 不唯一 ${blocked.不唯一} · 超预算 ${blocked.超预算} · 结构不过 ${blocked.结构不过}`);
  if (redundant) fail(`剪枝没剪到底：${redundant} 处冗余`);
  if (!boardsChecked) fail('没有可检的盘');
}

// ============================================================ 六、复解一致 + 分数是盘的属性
console.log('\n== 复解一致：同一 seed 重跑两次必须同分、同步数、同规则分布、同盘面、同抽数 ==');
{
  let drift = 0;
  for (let t = 0; t < TIERS.length; t++) {
    const a = generate(`again|${t}`, t);
    const b = generate(`again|${t}`, t);
    if (!a || !b) { drift++; fail(`${TIERS[t].name} 重跑抽不出盘（a=${!!a} b=${!!b}）`); continue; }
    const same = a.score === b.score && a.steps === b.steps && a.passes === b.passes &&
      ruleKey(a.ruleUse) === ruleKey(b.ruleUse) && JSON.stringify(a.grid) === JSON.stringify(b.grid) &&
      a.draws === b.draws && a.markers.length === b.markers.length;
    if (!same) {
      drift++;
      fail(`${TIERS[t].name} 同 seed 两张盘：${a.score}/${b.score} 分，${a.steps}/${b.steps} 步，${JSON.stringify(a.grid)}/${JSON.stringify(b.grid)}`);
    } else pass(`${TIERS[t].name} 两次同盘：${a.score} 分 / ${a.steps} 步 / ${a.markers.length} 记号 / 最大块 ${a.maxBlock} / 抽 ${a.draws} 次`);
  }
  if (drift) fail('复解一致破了');
}

console.log('\n== 分数是盘的属性：同一组记号换三条路径进来（生成器 / 直读 / 打乱顺序）必须同分同规则分布 ==');
{
  let bad = 0, checked = 0;
  for (const r of rows) {
    for (const g of r.boards.slice(0, Math.min(6, r.boards.length))) {
      checked++;
      // 打乱顺序用的随机数是**单独一个种子**抽的，且排序比较器里一个随机数都不抽。
      const rand = mulberry32(9000 + g.markers.length * 7919);
      const shuf = g.markers.slice();
      for (let i = shuf.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0;
        const tmp = shuf[i]; shuf[i] = shuf[j]; shuf[j] = tmp;
      }
      const direct = inspectBoard(g.w, g.h, g.markers, { budgetMs: r.tier.budgetMs, struct: r.tier.struct });
      const other = inspectBoard(g.w, g.h, shuf, { budgetMs: r.tier.budgetMs, struct: r.tier.struct });
      const same = direct.score === g.score && other.score === g.score &&
        direct.steps === g.steps && other.steps === g.steps &&
        ruleKey(direct.ruleUse) === ruleKey(g.ruleUse) && ruleKey(other.ruleUse) === ruleKey(g.ruleUse);
      if (!same) {
        bad++;
        fail(`${r.tier.name} 换路径不同分：生成 ${g.score}/${g.steps}，直读 ${direct.score}/${direct.steps}，乱序 ${other.score}/${other.steps}`);
      }
      if (!direct.shipped || !other.shipped) fail(`${r.tier.name} 同一张盘换路径就不出货了（直读 ${direct.shipped} / 乱序 ${other.shipped}）`);
    }
  }
  console.log(`  三路同分：${checked - bad}/${checked} 局`);
  if (bad) fail('分数带了生成器状态');
}

// ============================================================ 七、两条通道给同一份答案
console.log('\n== 出货盘的解：计数器交出的唯一解必须合法、且与铅笔的块数一致、且过结构下限 ==');
{
  let checked = 0, bad = 0;
  const shares = [];
  for (const r of rows) {
    for (const g of r.boards.slice(0, Math.min(4, r.boards.length))) {
      checked++;
      const c = proveUnique(g.w, g.h, g.markers, { budgetMs: r.tier.budgetMs, struct: r.tier.struct });
      if (!c.blocks) { bad++; fail(`${r.tier.name} 计数器没交出解`); continue; }
      const why = invalidReason(g.w, g.h, g.markers, c.blocks);
      if (why) { bad++; fail(`${r.tier.name}：唯一解被合法性通道判为 ${why}`); }
      if (!structureOk(c.blocks, r.tier.struct)) { bad++; fail(`${r.tier.name}：唯一解过不了结构下限（最大块 ${Math.max(...c.blocks.map((p) => (p.r1 - p.r0 + 1) * (p.c1 - p.c0 + 1)))} 格）`); }
      shares.push(Math.round((100 * g.maxBlock) / (g.w * g.h)));
      const v = solve(g.w, g.h, g.markers).verdict;
      if (v.regions !== c.blocks.length) { bad++; fail(`${r.tier.name}：铅笔给出 ${v.regions} 块，计数器给出 ${c.blocks.length} 块`); }
    }
  }
  console.log(`  ${checked - bad}/${checked} 张出货盘两条通道给出同一份合法分块；最大块占盘 ${q(shares, .5)}%（中位）..${q(shares, 1)}%（max）`);
  if (bad) fail('两条通道对不上');
}

// ============================================================ 八、出不起货的尺寸，每轮重量一遍
console.log(`\n== 抽不抽得出来：结构下限之内，每档 ${Number(process.env.BIG_DRAWS || 6000)} 抽（出货上限 ${DRAW_CEIL} 抽/盘）==`);
for (const u of UNSHIPPABLE) {
  const [w, h] = u.size;
  const DRAWS = Number(process.env.BIG_DRAWS || 6000);
  const rolls = 4;
  const rnd = mulberry32(u.seed ?? 31337);
  let draws = 0, tilings = 0, derived = 0, uniqOk = 0, rejected = 0;
  const t0 = performance.now();
  while (draws < DRAWS) {
    const p = plantedBoard(w, h, rnd, u.struct);
    if (p.reject) { rejected++; continue; }
    tilings++;
    let mk = p.markers;
    for (let r = 0; r < rolls && draws < DRAWS; r++, mk = markersFromTiling(p.rects, rnd)) {
      draws++;
      const run = solve(w, h, mk);
      if (!run.solved) continue;
      derived++;
      const c = proveUnique(w, h, mk, { budgetMs: Infinity, nodeBudget: 3e6 });
      if (c.sols === 1 && !c.stopped && c.blocks && structureOk(c.blocks, u.struct)) uniqOk++;
    }
  }
  const el = performance.now() - t0;
  const per = draws ? el / draws : 0;
  const price = uniqOk ? (draws / uniqOk) : Infinity;
  console.log(`  ${w}×${h} 结构[${u.struct.minRegions}块,最大块<=${u.struct.maxBlockCells}]：抽 ${draws}（分块 ${tilings}，被结构下限挡回 ${rejected} 张），铅笔推完 ${derived}，证唯一且解合格 ${uniqOk}`);
  console.log(`    ⇒ 出货率 ${((100 * uniqOk) / draws).toFixed(3)}%${Number.isFinite(price) ? `，一张 ${price.toFixed(0)} 抽 ≈ ${(price * per).toFixed(0)} ms/盘` : `，${draws} 抽内一张都抽不出来`}（墙钟 ${el.toFixed(0)} ms，单次 ${per.toFixed(2)} ms）`);
  console.log(`    ${u.reason}`);
  if (Number.isFinite(price) && price <= DRAW_CEIL) {
    fail(`${w}×${h} 现在 ${price.toFixed(0)} 抽就能出一张，出货上限 ${DRAW_CEIL} 抽 —— 这一档出得起货了，TIERS[] 该加档，别把它留在不出货清单里`);
  }
}

// ============================================================ 九、分数口径自证
console.log('\n== 分数口径自证：拿出货盘按 RULE_WEIGHT 手算一遍，必须等于出货分数 ==');
{
  const g = rows.flatMap((r) => r.boards)[0];
  if (!g) fail('没有盘可用于口径自证');
  else {
    const run = solve(g.w, g.h, g.markers);
    const ruleSum = Object.entries(run.ruleUse).reduce((a, [k, v]) => a + (RULE_WEIGHT[k] ?? 0) * v, 0);
    const hand = ruleSum + ROUND_WEIGHT * Math.max(0, run.passes - 1);
    console.log(`  手算 ${g.w}×${g.h} 一局：规则加权和 ${ruleSum} + 轮数项 ${ROUND_WEIGHT}×${run.passes - 1} = ${hand}，出货分数 ${g.score}`);
    if (hand !== g.score) fail('分数与口径手算不符');
    console.log(`  权重表：${Object.entries(RULE_WEIGHT).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    for (const r of rows) {
      const b = r.boards[0];
      if (!b) continue;
      console.log(`  ${b.tierKey} 盘面（第一局，${b.markers.length} 个记号）：\n${markerGrid(b.w, b.h, b.markers).map((s) => `    ${s}`).join('\n')}`);
    }
  }
}

console.log(`\n结论：${red ? `${red} 处门禁为红，见上文 ✗` : `${TIERS.length} 档阶梯与两条承诺都成立`}（${MEASURE ? '量测模式' : '门禁模式'}，红即 exit 1）`);
process.exit(red ? 1 : 0);
