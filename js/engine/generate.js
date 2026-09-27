// 出题器 · 畳バリ / Tatamibari
//
// 本文件只对一件事负责：**抽一张"铅笔推得完 **且** 计数器证得唯一"的盘**，然后把它剪到最小。
// 两个条件是 AND，不是 OR，理由分两头：
//
//   · 只要求"计数器证得唯一"，就是把本品类那句"零猜测"换成别的品类的话。
//     实测（选型卡 §1 与本轮同一台机器复跑）：随机铺盘 + `markersFromTiling` 直接给整记号集，
//     多块盘的推完率 6×6 只有 16/1500 = 1.1%，8×8 是 0/4000，10×10 是 0/2000。
//     而**证唯一本身是毫秒级**的（`tools/counter-cost.mjs`：6×6/8×8/10×10 证明 max 0.15/0.69/5.79 ms），
//     所以贵的一头从来不是计数器。
//   · 反过来只要求"推得完"也不够：铅笔通道若有 bug，它会推完一张其实有两个解的盘。
//     所以计数器是**第二意见**，出货前逐盘再跑一次 `limitSolutions: 2`。
//
// 于是搜索目标是"可推完"，剪枝也只在"两个条件都还成立"时才让这一步生效。
// `推得完 ⟹ 解唯一`（pencil.js 头文件第 3 条：每一步都在**所有**合法分块上成立），
// 所以计数器那一头正常时永远不 bind；它一 bind 就是在报引擎的 bug，那正是我们要看见的。
//
// 第三条判据是**结构下限**，它不是装饰：不加它的时候 6×6 抽到的"可推完多块盘"实测
// 16/16 张都是一块吃掉 30/36 格 + 三条 1×2 窄条，而 `randomTiling` 第一步有 1/(w·h) 的概率
// 把整盘一步放成一块——那种盘 R7 一眼就推得完。上一轮正是这种样本把聚合命中率说成 8.3% 的
// （选型卡 §2b 的打脸记录）。所以下限同时用在种盘与剪枝两处，判据见 `structureOk`。
//
// 尺寸档不是许愿许出来的。加满判据（结构下限 ∧ 推得完 ∧ 预算内证唯一）之后每出一张要抽多少次，
// 是本轮量出来的第一等数字（24 局/档，tries 放到 40000 不设限）：
//   4×4 中位 3 抽 · 4×5 6 · 5×5 43 · 5×6 244 · 6×6 689   （墙钟 7 / 9 / 25 / 97 / 398 ms 一局）
// 再往上一档就断了：7×7 是 1/30000 抽（≈17 s 一盘），8×8 与 10×10 是 0/30000 抽（`tools/balance.mjs`
// 第八节每轮重新量一遍并打印数字）。要开更大的档得先加推理规则，不是先加档名。
//
// 确定性：只用 `mulberry32(seed)`，没有 `Math.random()`；抽随机数绝不发生在 `sort` 的比较器里
// （node 与 Chrome 排序实现不同 ⇒ 同 seed 两张盘）。同一 seed 两次必须同一张盘。
// 同一条规矩也管墙钟：**任何随时间变的量都不许进搜索路径的谓词**。这轮实测抓到过一次破口——
// 剪枝那一步当初写的是"没击穿 budgetMs 才让删"，于是同一个 seed `again|3` 两跑给出两张 5×6 盘
// （179 分 / 171 分），差别来自某次试删的证明赶上一次 1 ms 级的抖动。现在谓词只看
// sols / 节点数 / 结构 / 铅笔（全是确定性量），`budgetMs` 只作读数与门禁（balance 第四段红给你看）。
//
// 分层说明：本文件用的 `randomTiling`（./tiling.js）与 `TATAMI`/`invalidReason`（./validate.js）
// 是**同一份定义**，只是家从 tools/ 搬进了 js/engine/——分块怎么长、"什么算合法盘"在本仓只许有
// 一份定义（穷举全部矩形分块那种封不住成本的走法仍然只住在 tools/，引擎不许调），
// 而运行时模块不许去够 tools/：本站要作为静态站发给浏览器，那条路径要么 404，
// 要么把台架代码当产品代码发出去。`tools/tiling_enum.mjs` 与 `tools/reference.mjs` 现在从这两处
// 再导出同样的名字，台架的 import 路径与断言都不受影响，语义一行没变。

import { countAnchored, MARKER_CHAR } from './counter.js';
import { solve } from './pencil.js';
import { markersFromTiling, mulberry32, randomTiling } from './tiling.js';
import { TATAMI, invalidReason } from './validate.js';

/** 种子：数字直接用，字符串走一遍定长的 FNV-1a（两条通道都确定性，且都不碰 Math.random）。 */
export function seedToNumber(seed) {
  if (typeof seed === 'number') return seed | 0;
  let h = 0x811c9dc5;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** Fisher-Yates：唯一的洗牌入口，随机数在这里抽，绝不在比较器里抽。台架要拿它验换顺序同分，所以是导出的。 */
export function shuffled(list, rand) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

const indices = (n) => Array.from({ length: n }, (_, i) => i);

/** 记号集规范化：同一张盘不管以什么顺序进来，都是同一个数组。分数是盘的属性，第一步就在这里。 */
export function canonicalMarkers(markers) {
  return markers
    .slice()
    .sort((a, b) => (a.r - b.r) || (a.c - b.c))
    .map((m) => ({ r: m.r, c: m.c, type: m.type }));
}

// ---------------------------------------------------------------- 难度分数
/**
 * 分数 = 这条铅笔路径的**读数**，不是生成器的状态。
 * 权重按"人要动多大脑子"排：R1/R7 是看一眼就下的结论，R3/R4 要算尺寸，R2 要背窗口表。
 * 轮数单独立一项：一轮推不动、要回头重扫全盘，是人眼最贵的那种成本。
 * 档位 band 由 tools/balance.mjs 实测回填，改一条规则权重就会把 band 门禁打红。
 */
export const RULE_WEIGHT = {
  'R1 记号互斥': 1,
  'R2 窗口构型表': 3,
  'R3 区域尺寸推理': 5,
  'R4 定形封闭': 7,
  'R5 记号可达': 2,
  'R6 候选形状收敛': 4,
  'R7 孤岛记号数': 1,
};
/** 每多一轮全表重扫的分值（实测：推得完的盘轮数 2–6，见 balance 打印的轮数分布） */
export const ROUND_WEIGHT = 25;

/**
 * 计数器单次调用：`limitSolutions: 2` 是唯一性通道（选型卡第 1 条：数到底的用法只能进台架）。
 *
 * 两个词得分开，因为它们落在不同的判据上：
 *   · `proved`  =  sols===1 且没撞节点预算。**节点数是确定性的**，所以这个量是搜索路径唯一能用的谓词。
 *   · `unique`  =  proved 且那次调用没击穿 `budgetMs`。墙钟不是确定性的（这台机器上 GC 与邻居
 *     agent 能把 0.1 ms 的调用抖成 1.0 ms），所以它**只作读数与门禁**，不作搜索谓词。
 * 这条区分是本轮实测抓出来的：把 `unique` 放进剪枝判据之后，同一个 seed `again|3` 两跑出过
 * 两张 5×6 盘（179 分 / 171 分），差别就来自某一次试删的证明赶上一次抖动、被预算挡了。
 * balance 第六段（同 seed 重跑必须同盘）就是这一条的守卫：把谓词改回墙钟，它就会红。
 */
export function proveUnique(w, h, markers, { budgetMs = Infinity, nodeBudget = 3e6 } = {}) {
  const r = countAnchored(w, h, markers, { limitSolutions: 2, nodeBudget });
  const overMs = r.ms > budgetMs;
  const overNodes = r.stopped;
  return {
    sols: r.sols,
    nodes: r.nodes,
    ms: r.ms,
    blocks: r.solution ? r.solution.map((p) => ({ r0: p.r0, c0: p.c0, r1: p.r1, c1: p.c1 })) : null,
    proved: r.sols === 1 && !overNodes,
    unique: r.sols === 1 && !overNodes && !overMs,
    overBudget: overNodes || overMs,
    overNodes,
    overMs,
  };
}

/**
 * 只读一张盘：铅笔跑一遍 + 计数器证一遍，返回出货判据与分数。
 * 本函数**不碰随机数**，所以它是"分数是盘的属性"这句话的检查点：
 * 同一组记号不管从生成器还是从存档文件进来，走的都是这里。
 */
export function inspectBoard(w, h, markers, opts = {}) {
  const mk = canonicalMarkers(markers);
  const run = solve(w, h, mk);
  const c = proveUnique(w, h, mk, opts);
  const ruleUse = {};
  for (const [rule, n] of Object.entries(run.ruleUse)) ruleUse[rule] = n;
  const ruleSum = Object.entries(ruleUse).reduce(
    (acc, [rule, n]) => acc + (RULE_WEIGHT[rule] ?? 0) * n,
    0,
  );
  const score = run.solved ? ruleSum + ROUND_WEIGHT * Math.max(0, run.passes - 1) : null;
  const struct = opts.struct || {};
  const maxBlock = c.blocks ? Math.max(...c.blocks.map(areaOf)) : null;
  return {
    w,
    h,
    markers: mk,
    solved: run.solved,
    score,
    steps: run.deductions,
    passes: run.passes,
    ruleUse,
    unknownEdges: run.unknownEdges,
    contradictions: run.contradictions.length,
    counter: c,
    maxBlock,
    structOk: !c.blocks || structureOk(c.blocks, struct),
    // 出货谓词只看确定性量（sols / 节点 / 结构 / 铅笔）。墙钟击穿在这里只记在 counter.overMs 上，
    // 由 balance 的门禁去红——不参与谓词，否则"同一张盘换个时刻就不出货了"。
    shipped: run.solved && c.proved && (!c.blocks || structureOk(c.blocks, struct)),
  };
}

// ---------------------------------------------------------------- 结构下限
/** 一块的面积 */
const areaOf = (p) => (p.r1 - p.r0 + 1) * (p.c1 - p.c0 + 1);

/**
 * 结构判据：块数 ≥ `minRegions` 且最大块 ≤ `maxBlockCells`。
 * 为什么必须有它：`randomTiling` 第一步有 1/(w·h) 的概率把整盘一步放成一块，
 * 那种盘**必然**"推得完"（R7 一眼看完全岛），实测 6×6 抽 300 张分块里有 11 张是它。
 * 上一轮就是被这种样本把聚合命中率说成 8.3% 的（选型卡 §2b 的打脸记录）。
 * 而 6×6 抽到的"多块"可推完盘，结构上全是**一块吃掉 30/36 格 + 三条 1×2 窄条**
 * （实测 16/16 张最大块占 83%，见 balance 的结构分布行）——那也不叫题目。
 * 所以这一条不是装饰：判据同时用在**种盘**（rects）与**剪枝**（计数器的解）两处，
 * 剪枝只许往下删记号，删到解的结构破掉就不再删。
 */
export function structureOk(blocks, { minRegions = 1, maxBlockCells = Infinity } = {}) {
  if (blocks.length < minRegions) return false;
  for (const p of blocks) if (areaOf(p) > maxBlockCells) return false;
  return true;
}

// ---------------------------------------------------------------- 种一张合法盘
/**
 * 长一张合法盘：`randomTiling` 生长时就守住禁四角（不是切完再筛），每块随机一格给记号，
 * 记号类型由该块形状读出。合法性走 `validate.invalidReason` 那条独立通道。
 */
export function plantedBoard(w, h, rnd, struct = {}) {
  const rects = randomTiling(w, h, { rnd, accept: TATAMI });
  if (!rects) return { reject: '分块没长出来' };
  if (rects.length < 2) return { reject: '整盘一块的退化盘' };
  if (!structureOk(rects, struct)) return { reject: '结构下限不过（块数太少或最大块太大）' };
  const markers = markersFromTiling(rects, rnd);
  const bad = invalidReason(w, h, markers, rects);
  if (bad) return { reject: `种盘非法：${bad}` };
  return { rects, markers: canonicalMarkers(markers) };
}

// ---------------------------------------------------------------- 剪枝
/**
 * 逐条试删，删完仍然"铅笔推得完 且 计数器证到唯一"才让这一步生效。
 * 一条删不动不等于永远删不动：删掉另一条之后它可能就可删了，所以整轮无改动才停。
 * `density` 是**下限**（保留多少比例的原生记号），那是本轮唯一允许的难度旋钮之一。
 * 谓词用 `proved`（sols 与节点数，都是确定性的），不用 `unique`（那一条含墙钟）——
 * 见 `proveUnique` 的头文件：把墙钟放进这一步的判据，同 seed 两跑就会给出两张盘。
 * 击穿预算的那次调用记在 `slowMs`，只作读数。
 * 返回的 `trials` 里带每一步的判据，balance 要拿它算"每条记号都不冗余"。
 * `maxMs`/`maxNodes` 是这一局剪枝期间**所有**计数器调用的尾巴——`budgetMs` 要盖过的就是它，
 * 不是最终那张盘的证明耗时（剪枝试删的那些盘记号更稀、搜索空间更大）。
 */
export function pruneMarkers(w, h, markers, rand, { density = 0, budgetMs = Infinity, nodeBudget = 3e6, maxPasses = 6, struct = {} } = {}) {
  let keep = markers.slice();
  const minMarkers = Math.max(2, Math.ceil(density * markers.length));
  const stat = { trials: 0, deleted: 0, pass: 0, pencilFail: 0, notUnique: 0, structureFail: 0, overNodes: 0, slowMs: 0, maxMs: 0, maxNodes: 0 };
  while (keep.length > minMarkers && stat.pass < maxPasses) {
    stat.pass++;
    let changed = 0;
    for (const i of shuffled(indices(keep.length), rand)) {
      if (keep.length <= minMarkers) break;
      const cand = keep.slice(0, i).concat(keep.slice(i + 1));
      const run = solve(w, h, cand);
      stat.trials++;
      if (!run.solved) {
        stat.pencilFail++;
        continue;
      }
      const c = proveUnique(w, h, cand, { budgetMs, nodeBudget });
      stat.maxMs = Math.max(stat.maxMs, c.ms);
      stat.maxNodes = Math.max(stat.maxNodes, c.nodes);
      if (c.overMs) stat.slowMs++;
      if (!c.proved) {
        if (c.overNodes) stat.overNodes++;
        else stat.notUnique++;
        continue;
      }
      // 删掉一条记号 = 少一块 = 有一块要吞掉更多格子。结构下限在这儿兜底，
      // 不然"剪到底"会把盘剪回"一大块 + 几条窄条"那种一眼题。
      if (c.blocks && !structureOk(c.blocks, struct)) {
        stat.structureFail++;
        continue;
      }
      keep = cand;
      changed++;
    }
    if (!changed) break;
  }
  stat.deleted = markers.length - keep.length;
  return { markers: keep, ...stat };
}

// ---------------------------------------------------------------- 档位
/**
 * 旋钮只有四个：尺寸、记号密度（`density` = 剪枝下限比例，`struct` = 解的结构下限）、band（分数区间）、
 * 试错上限（`tries` 抽数、`rolls` 一铺装几次记号位置）。下面每个数字都写着它的出处，
 * 改判据、改权重、换机器都得重跑一遍再抄——重跑命令就写在每一段头上。
 *
 * 【band】来源 `MEASURE=1 SAMPLES=24 node tools/balance.mjs`（出货口径预算，24 局/档，seed 固定
 * `balance|<档>|<局>`），取实测 min×0.95 到 max×1.05。当期实测：
 *   档   尺寸  分数区间    中位   band
 *   入门 4×4   78 .. 175    97   [74, 184]
 *   简单 4×5  102 .. 209   146   [96, 220]
 *   中等 5×5  112 .. 266   181   [106, 280]
 *   困难 5×6  129 .. 298   211   [122, 313]
 *   大师 6×6  174 .. 392   262   [165, 412]
 * 中位严格递增是阶梯门禁；band 之间大幅重叠是允许的（band 量的是"这一档的盘落在这个区间"，
 * 排序由中位那一 gate 承担），但相邻档的中位差必须 >0——否则就是某一档搬家了。
 *
 * 【budgetMs】= max(计数器调用尾巴 p95×4, max×2)，样本是 40 局/档的
 * `MEASURE_BUDGET_MS=Infinity` 跑（尾巴要含种盘那次证、每次试删那次证、出货盘再证一次：
 * 只看出货那一次会低估，因为试删的盘记号更稀、搜索空间更大）。当期实测 p95/max 与回填值：
 *   4×4 0.027/0.077 → 0.15 · 4×5 0.029/0.130 → 0.26 · 5×5 0.047/0.055 → 0.19
 *   5×6 0.051/0.094 → 0.21 · 6×6 0.142/1.647 → 3.29 ms
 * 6×6 那个 1.647 ms 是孤点（同档出货盘证明最长 0.147 ms），公式取 max×2 把它盖住——
 * 击穿等于弃掉一张已证唯一的盘，宁可预算松。选型卡 §1 给 6×6 的 0.39 ms 是按中位 7 块的随机盘量的，
 * 我们的盘是 13 块，尾巴本就该更宽。
 *
 * 【tries】出货上限，取抽数分布的 max 外扩。出货口径 24 局/档的实测（同一台机器）：
 *   4×4 中位 6 / max 21 —— 4×5 12/87 —— 5×5 59/244 —— 5×6 210/1101 —— 6×6 1292/6680 抽
 *   墙钟 2.3 / 7.2 / 23.2 / 110.2 / 747.6 ms 一局
 * 把 tries 摘掉不设限再量一遍（24 局/档，预算 Infinity）确认过尾巴没被截断：
 *   4×4 p50 3 / p90 12 / max 17 —— 4×5 6/34/85 —— 5×5 43/171/286 —— 5×6 244/494/1283 —— 6×6 689/2188/4837
 *   6×6 按 seed 计的拒收率：>1000 抽 9/24、>2000 抽 5/24、>6000 抽 0/24
 * 所以上限给到 100 / 400 / 1200 / 4000 / 12000。超限就返回 null，**调用方换 seed 重试**——
 * 生成器不许挂死，也不许放宽判据凑货。
 *
 * 【density】本轮被量成**死旋钮**：剪枝几乎删不动（每局删 0–3 条；20 局 186 次试删里 184 次是
 * "删了就推不完"），而尺寸×密度分位表里同一尺寸在密度 0/0.5/0.85 三行的中位分数互不递增
 * （4×4 116/85/120，5×5 205/174/182，5×6 227/217/215，6×6 226/261/256）。
 * 所以五档的难度全押在尺寸上，density 一律取 0（"能删就删"），只当"别删太狠"的下限用。
 *
 * 出得起货的只有这五档。7×7 往上：结构下限之内每档 30000 抽，7×7 出货 1/30000（18 s 一盘，
 * 是 6×6 中位那张的 24 倍价）、8×8 0/30000、10×10 0/30000——见 UNSHIPPABLE 与 balance 第八节，
 * 每轮重新量，抽得出就会红在这里。
 */
export const TIERS = [
  {
    key: 'newbie', name: '入门', size: [4, 4], density: 0, rolls: 1,
    struct: { minRegions: 5, maxBlockCells: 6 }, band: [74, 187], budgetMs: 0.20, tries: 100,
  },
  {
    key: 'easy', name: '简单', size: [4, 5], density: 0, rolls: 2,
    struct: { minRegions: 6, maxBlockCells: 7 }, band: [91, 220], budgetMs: 0.26, tries: 400,
  },
  {
    key: 'medium', name: '中等', size: [5, 5], density: 0, rolls: 3,
    struct: { minRegions: 7, maxBlockCells: 10 }, band: [106, 284], budgetMs: 0.26, tries: 1200,
  },
  {
    key: 'hard', name: '困难', size: [5, 6], density: 0, rolls: 4,
    struct: { minRegions: 8, maxBlockCells: 12 }, band: [122, 313], budgetMs: 2.00, tries: 4000,
  },
  {
    key: 'master', name: '大师', size: [6, 6], density: 0, rolls: 5,
    struct: { minRegions: 7, maxBlockCells: 12 }, band: [147, 412], budgetMs: 5.30, tries: 12000,
  },
];

/**
 * 本轮**出不起货**的尺寸，连同量出这个结论的抽数与结构下限。
 * 留在代码里是因为 balance 每轮要重新量一次：只要这一档抽得出结构合格的盘，
 * balance 就红，逼着下一轮把它加回 TIERS[]——这条结论不许变成传说。
 * 数字来自本轮 `BIG_DRAWS=30000 node tools/balance.mjs`（第八节，判据与 TIERS 逐字相同：
 * 铅笔推得完 ∧ limitSolutions:2 证唯一 ∧ 解过结构下限）。
 */
export const UNSHIPPABLE = [
  {
    size: [7, 7], struct: { minRegions: 9, maxBlockCells: 16 },
    reason: '7×7 结构[9块,最大块<=16] 30000 抽只出 1 张（≈17 s/盘，最贵的一档 6×6 是 0.4 s），' +
      '整记号集的推完率同向：选型卡 §1 8×8 0/40、本轮复跑 8×8 0/4000。要开得先加推理规则。',
  },
  {
    size: [8, 8], struct: { minRegions: 9, maxBlockCells: 20 },
    reason: '8×8 结构[9块,最大块<=20] 30000 抽 0 张：铅笔推完 0 张，判据一条都没bind（8×8 0/30000）。' +
      '整记号集那一路也是 0/4000 抽（选型卡 §1 同向：8×8 0/40）。',
  },
  {
    size: [10, 10], struct: { minRegions: 12, maxBlockCells: 25 },
    reason: '10×10 结构[12块,最大块<=25] 30000 抽 0 张（放宽到 [9块,<=34] 也是 0/30000）。' +
      '证唯一本身不贵（选型卡 §1：10×10 证明 max 5.79 ms），贵的是"推得完"：整记号集 0/2000 抽。',
  },
];

export const tierIndexFor = (i) => {
  if (typeof i === 'string') {
    const k = TIERS.findIndex((t) => t.key === i);
    return k < 0 ? 0 : k;
  }
  return Math.min(TIERS.length - 1, Math.max(0, i | 0));
};
export const tierFor = (i) => TIERS[tierIndexFor(i)];

/** 盘 → 行字符串，给 UI 与存档用；'.' 表示空格。 */
export function markerGrid(w, h, markers) {
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  for (const m of markers) g[m.r][m.c] = MARKER_CHAR[m.type];
  return g.map((row) => row.join(''));
}

// ---------------------------------------------------------------- 出货
/**
 * 一局：种合法盘 → 选一个可推完的记号集（同一分块重掷记号位置，重抽分块）→ 剪到最小。
 * `tries` 封顶，坏种子要**响亮地失败**（返回 null），不能挂在构建步骤上。
 * 返回里的 `attempts`/`draws` 是本轮的第一等数字：出不出得起货就看它。
 */
/**
 * 出货核心：`cfg` 是一份档位配置（尺寸 + 四个旋钮），TIERS[] 只是它的五份存档。
 * 拆成参数而不是只读 TIERS[]，是为了让 balance 能拿同一套代码去量"尺寸 × 密度"的分位表，
 * 而那份表就是 band 与 tries 的唯一来源。
 */
export function generateOn(seed, cfg, opts = {}) {
  const t = cfg;
  const [w, h] = t.size;
  const budgetMs = opts.budgetMs ?? t.budgetMs;
  const nodeBudget = opts.nodeBudget ?? 3e6;
  const tries = opts.tries ?? t.tries;
  const rolls = opts.rolls ?? t.rolls;
  const struct = opts.struct ?? t.struct;
  const density = opts.density ?? t.density;
  const rnd = mulberry32(seedToNumber(seed));
  const stat = {
    attempts: 0, draws: 0, tilings: 0,
    reject: { 分块没长出来: 0, 整盘一块的退化盘: 0, 结构下限不过: 0, 种盘非法: 0, 铅笔推不完: 0, 计数器没证到唯一: 0, 节点预算内没证完: 0, 解的结构下限不过: 0 },
    stuck: [], pruneTrials: 0, pruneDeleted: 0, prunePasses: 0, pruneStructure: 0, overNodes: 0,
    // 击穿墙钟预算的调用次数。**只作读数**：它进不了谓词（见 proveUnique 头文件），
    // 由 balance 第四段与门禁"超预算 0 局"负责让它红。
    slowMs: 0,
    // 本局**所有**计数器调用的尾巴（种盘证一遍、每次试删一遍、出货盘再证一遍）。
    // budgetMs 是按这个数回填的，不是按最终那张盘的证明耗时——后者会低估尾巴。
    proofMs: 0, proofNodes: 0,
  };
  const seen = (r) => {
    stat.proofMs = Math.max(stat.proofMs, r.ms);
    stat.proofNodes = Math.max(stat.proofNodes, r.nodes);
    return r;
  };
  const bump = (key, n = 1) => { stat.reject[key] = (stat.reject[key] || 0) + n; };

  while (stat.draws < tries) {
    stat.attempts++;
    const planted = plantedBoard(w, h, rnd, struct);
    if (planted.reject) {
      bump(planted.reject.startsWith('种盘非法') ? '种盘非法' : planted.reject.split('（')[0]);
      continue;
    }
    stat.tilings++;
    let markers = planted.markers;
    for (let roll = 0; roll < rolls && stat.draws < tries; roll++, markers = canonicalMarkers(markersFromTiling(planted.rects, rnd))) {
      stat.draws++;
      const run = solve(w, h, markers);
      if (!run.solved) {
        bump('铅笔推不完');
        stat.stuck.push(run.unknownEdges);
        continue;
      }
      const c = seen(proveUnique(w, h, markers, { budgetMs, nodeBudget }));
      // 拒收只看确定性量：节点没证完、解不止一个、解的结构不合格。墙钟击穿记进 slowMs 当读数，
      // 不改变这一步的取舍——否则同 seed 两跑会抽出两张盘（本轮实测抓到过）。
      if (c.overMs) stat.slowMs++;
      if (c.overNodes) { bump('节点预算内没证完'); stat.overNodes++; continue; }
      if (c.sols !== 1) { bump('计数器没证到唯一'); continue; }
      // 种下的分块合法，不代表这组记号的**解**是那张分块：解可能另有一种切法。
      // 所以结构判据要作用在计数器交出的解上，不然退化盘会从这条路漏进来。
      if (c.blocks && !structureOk(c.blocks, struct)) { bump('解的结构下限不过'); continue; }
      const pruned = pruneMarkers(w, h, markers, rnd, { density, budgetMs, nodeBudget, struct });
      stat.pruneTrials += pruned.trials;
      stat.pruneDeleted += pruned.deleted;
      stat.prunePasses += pruned.pass;
      stat.pruneStructure += pruned.structureFail;
      stat.overNodes += pruned.overNodes;
      stat.slowMs += pruned.slowMs;
      stat.proofMs = Math.max(stat.proofMs, pruned.maxMs);
      stat.proofNodes = Math.max(stat.proofNodes, pruned.maxNodes);
      const board = inspectBoard(w, h, pruned.markers, { budgetMs, nodeBudget, struct });
      seen(board.counter);
      return {
        seed,
        tier: t.index ?? null,
        tierKey: t.key,
        w, h,
        markers: board.markers,
        grid: markerGrid(w, h, board.markers),
        score: board.score,
        steps: board.steps,
        passes: board.passes,
        ruleUse: board.ruleUse,
        solved: board.solved,
        shipped: board.shipped,
        maxBlock: board.maxBlock,
        plantedMarkers: planted.markers.length,
        counter: board.counter,
        ...stat,
      };
    }
  }
  return null;
}

/** 一局：按 TIERS[tier] 的旋钮出货；抽不到返回 null（坏种子响亮失败，不挂住调用方）。 */
export function generate(seed, tier = 0, opts = {}) {
  const index = tierIndexFor(tier);
  return generateOn(seed, { ...TIERS[index], index }, opts);
}

export const describePuzzle = (p) =>
  `${p.w}×${p.h} · ${p.markers.length} 个记号（原盘 ${p.plantedMarkers} 块）· 难度分 ${p.score} · 铅笔 ${p.steps} 步 ${p.passes} 轮 · 最大块 ${p.maxBlock} 格`;
