// 铅笔通道测试台 · 每一步都必须"在所有解里成立"
//
// 计数器那两套的验法是"彼此独立的实现互相对答案"。这条通道**不能**那么验：
// 它和计数器共享同一套状态推进思路，自洽只能证明"没写出运行时错误"，
// 证明不了"零猜测"。真正要钉的是另一件事——人照着它画出来的每一条线，
// 都必须在**所有**解里成立。所以这里分四层：
//
//   A) 底座：containment / wallPrefix 两个前缀和工具逐个对暴力枚举；
//      窗口许可表对 4×4 **全部**长方形分块读出的真值掩码。
//      三态视图 11 种 vs 真值闭包 7 种，差的 4 种必须是"四格同块"的半成品写法。
//   B) 每条命名规则单独跑（runRule）：给定局面必须由**它**给出那条结论，
//      而且只给出那条 —— 多算一条都算失败。理由串里带错字符、带错格号同样算失败，
//      因为那句话就是玩家看到的提示，这一节是"提示不是答案"的凭据。
//   C) 真值逐条审计：sampleBoard 生成的盘带着生成它的分块，
//      求解器推出的每条边都和真值比 —— 这条通道的错只能这么抓（自洽完全看不出来）。
//      另外钉住蕴含方向：推得完 ⇒ 计数器限 2 数到 1，且整盘过 rules.js 复核。
//      单条规则也这么抓：R6 单独从空盘跑一遍，断言集合与**另一份不用前缀和的实现**
//      逐盘比相等（越权、漏权各一条），每条断言再和真值比。
//   D) 强度差与推完率：难度分数的原料，也是"出货只能挑铅笔推得完的盘"的代价。
//
// ── 确定性是本文件的承诺，不是愿望 ────────────────────────────────
// 本闸跑两遍必须**逐字节相同**，包括打印出来的每一个数字。为此：
//   1. 一切随机都从 `mulberry32(种子)` 来，种子写在代码里（`boardSeed` / A 节的两个定值），
//      没有任何一处用 `Math.random()`；`randomTiling` 的洗牌也是 Fisher-Yates 抽有源 rnd。
//   2. **不量墙钟**。时间不是可复算的量：同一台机器同一份代码，`performance.now()`
//      每次都不同，拿它进打印就等于让输出随机器负载漂。成本改用可复算的整数说：
//      计数器证词的**节点数**、铅笔通道的**轮数与断言条数**，p95 取尾巴而不是中位数
//      （见项目记忆「时延基线要取尾巴」）。真正的墙钟基线在 tools/counter-cost.mjs 那类
//      台架里量，与 tools/counter-test.mjs 的分工一致：**这里只保证正确**。
//   3. 样本集本身有摘要哨兵（`fnv`）：换了种子、换了 `mulberry32`、换了 `sampleBoard`
//      都会先撞摘要，而不是悄悄换掉一批盘后照样绿。打印过而没断言的量都算没测到，
//      所以盘数 / 唯一数 / 推完数 / 规则使用合计也都逐档钉住（哨兵，见每行注释）。
//   4. 引擎必须能被浏览器 import：A0 节拿文本扫 `js/engine/*`，有 node 专属入口就红。
//
// 坐标与方向约定见 js/engine/pencil.js：dir 0上 1右 2下 3左，格号 i = r*w + c。
// 一条边只由"右、下"两个方向记录（见 B 节 R6 那条断言），
// 所以同一面墙不会一会儿叫"格 3 的右侧"、一会儿叫"格 4 的左侧"。

import { readFileSync, readdirSync } from 'node:fs';
import {
  UNKNOWN, WALL, SAME, createSt, putEdge, runRule, step, solve, verdict,
  containment, wallPrefix, WINDOW_OK, windowAllowed, equalMask, windowConfigName,
} from '../js/engine/pencil.js';
import {
  countAnchored, countCover, aspectOk, MARKER_CHAR, T_WIDE, T_TALL, T_SQUARE,
} from '../js/engine/counter.js';
import { windmillPoints } from '../js/engine/rules.js';
import { eachRectTiling, countAnchoredTilings, mulberry32, quantile } from './tiling_enum.mjs';
import { sampleBoard, invalidReason, rectsOf } from './reference.mjs';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); fail++; }
}
function eq(name, got, want) { ok(name, got === want, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`); }

const ix = (w, r, c) => r * w + c;
const M = (r, c, type) => ({ r, c, type });

/** 只跑一条规则，返回它这一步新产生的断言 */
function fired(st, rule) {
  const n = st.facts.length;
  runRule(st, rule);
  return st.facts.slice(n);
}
const key = (i, d, want) => `${i},${d},${want}`;
const keysOf = (got) => got.map((f) => key(f.i, f.dir, f.want)).sort().join(' ');
/** 断言"恰好新增了这几条边"。规则越权比不作为更难发现，所以这里是集合相等而不是包含。 */
function onlyEdges(name, got, want) {
  ok(name, keysOf(got) === want.map((e) => e.join(',')).sort().join(' '), `实得 [${keysOf(got)}]`);
}
function hasReason(got, i, d, re, name) {
  const f = got.find((x) => x.i === i && x.dir === d);
  ok(`${name}：格 ${i} 的${['上', '右', '下', '左'][d]}侧理由说得出人话`,
    !!f && re.test(f.reason), f ? `理由=${f.reason}` : '没有这条断言');
}
const badOf = (st) => [...new Map(st.contradictions.map((c) => [`${c.rule}|${c.detail}`, c])).values()];
function hasBad(name, st, rule, re) {
  const hit = badOf(st).filter((c) => c.rule === rule && re.test(c.detail));
  ok(name, hit.length > 0, `矛盾=${JSON.stringify(badOf(st))}`);
}

/** 分块规范化（按首现顺序重命名），用来比两份 labeling 是不是同一个划分 */
function canon(lab) {
  const m = new Map();
  let s = '';
  for (const v of lab) {
    if (!m.has(v)) m.set(v, m.size);
    s += m.get(v) + ',';
  }
  return s;
}

/**
 * 样本盘的种子。整个测试台只有这一个取样公式：改了它 = 换了样本集，
 * 会先被 C 节的摘要哨兵撞下来，而不是悄悄把覆盖范围换掉。
 */
const boardSeed = (w, h, k) => k * 7919 + w * 31 + h;

/** FNV-1a 32 位：只用到 `Math.imul`，跨引擎逐位一致，所以能当"逐字节相同"的凭据。 */
function fnv(s) {
  let s0 = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    s0 ^= s.charCodeAt(i);
    s0 = Math.imul(s0, 16777619) >>> 0;
  }
  return s0.toString(16).padStart(8, '0');
}
/** 空样本不给 NaN：NaN 会一路混进打印，看起来像"测过了"。 */
const q = (xs, p) => (xs.length ? quantile(xs, p) : '—');

/** 断言集合的规范化串（`i,dir,want` 逐条排序），比较两份实现给的边集。 */
const edgeSet = (it) => [...it].slice().sort().join(' ');

/**
 * R6 的独立参照实现：**不用** wallPrefix / containment / markerCountIn 那三张前缀和表，
 * 每个候选矩形都逐格扫边、逐格数记号。它也跑自己的定点，好和 `runRule(st,'R6')`
 * 的"推到不动为止"对齐。两套的分歧只能来自实现，不可能来自规则语义——
 * "不许凭空造出跨记号、跨已知墙的候选"这句承诺由这条对答案钉住。
 * `seeds` 是玩家/测试台已经画下的边，两套都必须在同样的起点上起跑。
 */
function r6Brute(w, h, markers, seeds = []) {
  const st = createSt(w, h, markers);
  for (const [i, d, v] of seeds) putEdge(st, i, d, v);
  const at = new Int32Array(w * h).fill(-1);
  markers.forEach((mm, mi) => { at[mm.r * w + mm.c] = mi; });
  const out = new Set();
  for (;;) {
    const before = out.size;
    for (let mi = 0; mi < markers.length; mi++) {
      const m = markers[mi];
      const cands = [];
      for (let r0 = 0; r0 <= m.r; r0++) for (let r1 = m.r; r1 < h; r1++)
        for (let c0 = 0; c0 <= m.c; c0++) for (let c1 = m.c; c1 < w; c1++) {
          const ww = c1 - c0 + 1, hh = r1 - r0 + 1;
          if (!aspectOk(ww, hh, m.type)) continue;
          let nm = 0, walls = 0;
          for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const i = r * w + c;
            if (at[i] >= 0) nm++;
            if (c < c1 && st.right[i] === WALL) walls++;
            if (r < r1 && st.down[i] === WALL) walls++;
          }
          if (nm === 1 && walls === 0) cands.push([r0, c0, r1, c1]);
        }
      if (!cands.length) continue;
      const cnt = new Int32Array(w * h);
      for (const [r0, c0, r1, c1] of cands) {
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cnt[r * w + c]++;
      }
      for (let i = 0; i < w * h; i++) for (const d of [1, 2]) {
        const c = i % w, r = (i / w) | 0;
        const j = d === 1 ? (c < w - 1 ? i + 1 : -1) : (r < h - 1 ? i + w : -1);
        if (j < 0) continue;
        if ((d === 1 ? st.right[i] : st.down[i]) !== UNKNOWN) continue;
        let want = 0;
        if (cnt[i] === cands.length && cnt[j] === cands.length) want = SAME;
        else if ((cnt[i] === cands.length && cnt[j] === 0) || (cnt[j] === cands.length && cnt[i] === 0)) want = WALL;
        if (!want) continue;
        const k = `${i},${d},${want}`;
        if (out.has(k)) continue;
        out.add(k);
        if (d === 1) st.right[i] = want; else st.down[i] = want;
      }
    }
    if (out.size === before) return out;
  }
}

/** 某个记号当前的候选矩形（同样逐格扫，不走前缀和），用来把"候选只剩两种"这句话钉死。 */
function candsBrute(st, mi) {
  const { w, h, markers } = st;
  const m = markers[mi];
  const at = new Int32Array(w * h).fill(-1);
  markers.forEach((mm, qi) => { at[mm.r * w + mm.c] = qi; });
  const out = [];
  for (let r0 = 0; r0 <= m.r; r0++) for (let r1 = m.r; r1 < h; r1++)
    for (let c0 = 0; c0 <= m.c; c0++) for (let c1 = m.c; c1 < w; c1++) {
      const ww = c1 - c0 + 1, hh = r1 - r0 + 1;
      if (!aspectOk(ww, hh, m.type)) continue;
      let nm = 0, walls = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * w + c;
        if (at[i] >= 0) nm++;
        if (c < c1 && st.right[i] === WALL) walls++;
        if (r < r1 && st.down[i] === WALL) walls++;
      }
      if (nm === 1 && walls === 0) out.push([r0, c0, r1, c1].join(':'));
    }
  return out.sort();
}
/** 把候选集摊成"每格被多少个候选包含"，与 containment() 无关的写法。 */
function containBrute(w, h, cands) {
  const cnt = new Int32Array(w * h);
  for (const s of cands) {
    const [r0, c0, r1, c1] = s.split(':').map(Number);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cnt[r * w + c]++;
  }
  return cnt;
}

// ================================================== A0) 引擎得能被浏览器 import
console.log('== A0) js/engine/* 不得出现 node 专属入口；本闸不得读时间 ==');
{
  // 名单从目录现读，绝不写死。旧写法是 `['rules.js','counter.js','pencil.js']`，而带反转边
  // 的那一个（generate.js 在 816e61b 之前 import tools/reference.mjs）从来不在名单里——
  // 本文件头部第 4 条承诺「A0 节拿文本扫 js/engine/*」，扫一个写死的三元组就是承诺了没做。
  // 名单一变，这一节的覆盖面与条数一起变（3 个文件 → 现读到的每一个），所以条数要重钉。
  const files = readdirSync(new URL('../js/engine/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .sort();
  ok(`A0 扫的是目录本身而不是名单（现读到 ${files.length} 个 .js）`,
    files.length >= 6 && ['generate.js', 'pencil.js', 'counter.js', 'rules.js'].every((f) => files.includes(f)),
    files.join(','));
  // 扫的是**代码**：注释里写「没有 Math.random()」是在陈述承诺，不是在违反它。
  // generate.js:29 那句话就是这种散文——不剥注释的话，红的是文档而不是缺陷。
  // 与本文件给自己定的那条同一口径（下面 :237-238 那一段筛掉的正是注释行）。
  const codeOf = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
  const hits = [];
  for (const f of files) {
    const src = codeOf(readFileSync(new URL(`../js/engine/${f}`, import.meta.url), 'utf8'));
    for (const re of [/require\s*\(/, /\bnode:/, /\bprocess\./, /\b__dirname\b/, /\bglobal\.Buffer\b/]) {
      const m = src.match(re);
      if (m) hits.push(`${f}: 出现 node 专属入口 ${re.source} → "${m[0]}"`);
    }
    for (const imp of src.matchAll(/from\s+'([^']+)'/g)) {
      if (!imp[1].startsWith('./')) hits.push(`${f}: 只准 import 引擎内的 ./ 模块，实为 ${imp[1]}`);
    }
  }
  eq(`${files.length} 个引擎文件里 node 专属入口 / 越出 js/engine 的 import 命中数`, hits.length, 0);
  if (hits.length) for (const s of hits) console.log('     ' + s);
  // 时间只能出现在"顺手记录 ms 字段"里，不许进判断、不许进打印。本闸自己也得守这条。
  const code = readFileSync(new URL(import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  eq('本闸正文（注释除外）里 performance.now / Date.now / Math.random 的命中数',
    (code.match(/performance\.now\s*\(|Date\.now\s*\(|Math\.random\s*\(/g) || []).length, 0);
  for (const f of files) {
    const src = codeOf(readFileSync(new URL(`../js/engine/${f}`, import.meta.url), 'utf8'));
    for (const re of [/Date\.now\s*\(/, /Math\.random\s*\(/, /new Date\s*\(/]) {
      ok(`${f} 的代码（注释除外）里没有 ${re.source}`, !re.test(src));
    }
  }
}

// ================================================== A) 底座：前缀和与窗口表
console.log('\n== A) containment / wallPrefix 对暴力，窗口许可表对真值 ==');
{
  const rnd = mulberry32(20260927);
  const w = 7, h = 5;
  let mism = 0, rects = 0, rectKey = '';
  for (let t = 0; t < 300; t++) {
    const rs = [];
    const n = 1 + ((rnd() * 9) | 0);
    for (let k = 0; k < n; k++) {
      const r0 = (rnd() * h) | 0, r1 = r0 + ((rnd() * (h - r0)) | 0);
      const c0 = (rnd() * w) | 0, c1 = c0 + ((rnd() * (w - c0)) | 0);
      rs.push([r0, c0, r1, c1]);
    }
    rects += rs.length;
    rectKey += `${t}:${rs.map((p) => p.join(',')).join('/')};`;
    const got = containment(w, h, rs);
    const want = new Int32Array(w * h);
    for (const [r0, c0, r1, c1] of rs) {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) want[r * w + c]++;
    }
    for (let i = 0; i < w * h; i++) if (got[i] !== want[i]) mism++;
  }
  eq('containment 与暴力逐格计数 300 轮全等（不符格数 0）', mism, 0);
  // 哨兵：输入样本集的身份。换了种子 / 换了 mulberry32 先在这里红，
  // 而不是留下一句"全等"其实悄悄换了 1465 个矩形去跑。
  eq('containment 那 300 轮的输入样本身份（矩形总数 + 摘要）', `${rects}/${fnv(rectKey)}`, '1465/3689c93d');
}
{
  const rnd = mulberry32(555);
  const w = 6, h = 6;
  const st = createSt(w, h, [M(0, 0, T_WIDE)]);
  for (let i = 0; i < w * h; i++) {
    st.right[i] = (rnd() * 3) | 0;        // 连越界槽位一起填：wallPrefix 本就不该看它们
    st.down[i] = (rnd() * 3) | 0;
  }
  const countWalls = wallPrefix(st);
  const brute = (r0, c0, r1, c1) => {
    let n = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0 + 1; c <= c1; c++) if (st.right[r * w + c - 1] === WALL) n++;
    for (let r = r0 + 1; r <= r1; r++) for (let c = c0; c <= c1; c++) if (st.down[(r - 1) * w + c] === WALL) n++;
    return n;
  };
  let mism = 0, nonzero = 0, single = 0, qKey = '';
  for (let t = 0; t < 400; t++) {
    const r0 = (rnd() * h) | 0, r1 = r0 + ((rnd() * (h - r0)) | 0);
    const c0 = (rnd() * w) | 0, c1 = c0 + ((rnd() * (w - c0)) | 0);
    const b = brute(r0, c0, r1, c1);
    qKey += `${r0},${c0},${r1},${c1}=${b};`;
    if (countWalls(r0, c0, r1, c1) !== b) mism++;
    if (b) nonzero++;
    if (r0 === r1 && c0 === c1) single++;
  }
  eq('wallPrefix 与暴力逐矩形全等（400 轮 0 不符）', mism, 0);
  ok('这盘查询不是空转（内部真有墙的矩形 ≥ 50 个）', nonzero >= 50, `nonzero=${nonzero}`);
  ok('单格矩形也被查到过（≥ 20 次）', single >= 20, `single=${single}`);
  // 单格矩形内部没有边：前缀和的端点约定最容易在这里写错
  eq('单格矩形内部墙数恒为 0', countWalls(2, 2, 2, 2), 0);
  eq('wallPrefix 的输入身份（盘面墙位 + 400 次查询及其真值 摘要）', fnv(qKey), '72b33b36');
}
{
  // 真值掩码：走完 4×4 全部长方形分块，只从**已完成的**分块里读窗口
  const tatami = new Set(), all = new Set();
  let tilings = 0, withWindmill = 0;
  eachRectTiling(4, 4, (lab) => {
    tilings++;
    const bad = windmillPoints(lab, 4, 4).length > 0;
    if (bad) withWindmill++;
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) {
      const q = [ix(4, y - 1, x - 1), ix(4, y - 1, x), ix(4, y, x - 1), ix(4, y, x)];
      const m = equalMask(q.map((i) => lab[i]));
      all.add(m);
      if (!bad) tatami.add(m);
    }
  });
  eq('4×4 长方形分块总数（两份枚举器必须同数）', tilings, countAnchoredTilings(4, 4).hit);
  eq('这个总数就是计数器成本那节的 70878', tilings, 70878);
  console.log(`  4×4 分块 ${tilings} 个，其中含风车的 ${withWindmill} 个`);
  eq('禁四角之后，真值窗口掩码只有 7 种', [...tatami].sort((a, b) => a - b).join(','), '1,2,4,5,8,10,15');
  eq('不禁四角只多一种：风车 0', [...all].sort((a, b) => a - b).join(','), '0,1,2,4,5,8,10,15');
  eq('风车掩码一定不被许可', windowAllowed(0), false);
  eq('三态视图的许可表有 11 种', WINDOW_OK.length, 11);
  eq('许可表 = 7 种真值 + 4 种"四格同块"的半成品写法',
    WINDOW_OK.filter((m) => !tatami.has(m)).sort((a, b) => a - b).join(','), '7,11,13,14');
  ok('那 4 种半成品说的是同一句话',
    [7, 11, 13, 14, 15].every((m) => windowConfigName(m) === '四格同属一块（点落在块内部）'));
  eq('被排除的 5 种 = 风车 + 4 种三加一',
    [...Array(16).keys()].filter((m) => !windowAllowed(m)).sort((a, b) => a - b).join(','), '0,3,6,9,12');
  eq('三加一里的 NW=NE=SW 确实不可实现', windowAllowed(3), false);
  eq('三加一的另两种写法（掩码 9、6）同样不许可',
    [windowAllowed(9), windowAllowed(6)].join(','), 'false,false');
  console.log('  7 种真值构型：' + [...tatami].sort((a, b) => a - b)
    .map((m) => `${m}=${windowConfigName(m)}`).join('；'));
}

// ================================================== B) 逐条命名规则
console.log('\n== B) 每条规则单独跑：这句话必须由它来说 ==');

// ---- R1 记号互斥
{
  const st = createSt(2, 2, [M(0, 0, T_WIDE), M(0, 1, T_SQUARE), M(1, 0, T_SQUARE), M(1, 1, T_WIDE)]);
  const got = fired(st, 'R1');
  onlyEdges('2×2 四个记号 ⇒ 四条内部边全是墙', got,
    [[ix(2, 0, 0), 1, WALL], [ix(2, 0, 0), 2, WALL], [ix(2, 0, 1), 2, WALL], [ix(2, 1, 0), 1, WALL]]);
  eq('R1 这一步不报矛盾', badOf(st).length, 0);
  // MARKER_CHAR 按类型下标：拿记号序号去索引它，这里就会把 `+` 写成 `|`
  hasReason(got, ix(2, 1, 0), 1, /两侧各有一个记号（`\+`、`-`）/, 'R1 相邻记号');
  hasReason(got, ix(2, 0, 1), 2, /两侧各有一个记号（`\+`、`-`）/, 'R1 相邻记号');
}
{
  // 区域级：边上两格都不是记号，理由必须报出**两块各自**的记号
  const st = createSt(4, 3, [M(1, 1, T_WIDE), M(1, 3, T_TALL)]);
  putEdge(st, ix(4, 1, 1), 1, SAME);            // (1,1) 与 (1,2) 已经并成一块
  const got = fired(st, 'R1');
  onlyEdges('两块各已含一个记号 ⇒ 公共边只能是墙', got, [[ix(4, 1, 2), 1, WALL]]);
  hasReason(got, ix(4, 1, 2), 1, /\(1,2\) 所在的块已含记号 `-`，\(1,3\) 所在的块已含记号 `\|`/, 'R1 区域级');
}
{
  const st = createSt(3, 3, [M(0, 0, T_WIDE), M(0, 1, T_TALL)]);
  putEdge(st, ix(3, 0, 0), 1, SAME);            // 人为把两个记号并进一块
  fired(st, 'R1');
  hasBad('一块里进了两个记号 ⇒ 矛盾', st, 'R1 记号互斥', /一块里被打通进了 2 个记号/);
}

// ---- R2 窗口构型表
{
  const st = createSt(4, 4, [M(0, 0, T_SQUARE)]);
  // 格点(1,1) 的 B(NW 下)、C(SW 右)、D(NE 下) 是墙，只剩 A
  for (const [i, d] of [[ix(4, 0, 0), 2], [ix(4, 1, 0), 1], [ix(4, 0, 1), 2]]) putEdge(st, i, d, WALL);
  const got = fired(st, 'R2');
  onlyEdges('三墙围出的第四边只能打通', got, [[ix(4, 0, 0), 1, SAME]]);
  hasReason(got, ix(4, 0, 0), 1, /格点\(1,1\) 只剩一种许可构型：T 形连接：上两格同块/, 'R2 逼出同块');
}
{
  const st = createSt(4, 4, [M(0, 0, T_SQUARE)]);
  putEdge(st, ix(4, 0, 0), 1, SAME);
  putEdge(st, ix(4, 0, 0), 2, WALL);
  putEdge(st, ix(4, 1, 0), 1, WALL);
  const got = fired(st, 'R2');
  onlyEdges('三加一填不满外接框 ⇒ 第四边只能是墙', got, [[ix(4, 0, 1), 2, WALL]]);
  hasReason(got, ix(4, 0, 1), 2, /只剩一种许可构型：T 形连接：上两格同块/, 'R2 逼出墙');
}
{
  const st = createSt(4, 4, [M(0, 0, T_SQUARE)]);
  for (const [i, d] of [[ix(4, 0, 0), 1], [ix(4, 0, 0), 2], [ix(4, 1, 0), 1], [ix(4, 0, 1), 2]]) {
    putEdge(st, i, d, WALL);
  }
  fired(st, 'R2');
  hasBad('四格四块（风车）当场矛盾', st, 'R2 窗口构型表',
    /格点\(1,1\) 四周的四格怎么连都不在 11 种许可构型里/);
}

// ---- R3 区域尺寸推理
{
  const st = createSt(3, 3, [M(1, 1, T_WIDE)]);
  putEdge(st, ix(3, 1, 1), 1, SAME);
  putEdge(st, ix(3, 1, 1), 3, WALL);
  putEdge(st, ix(3, 1, 2), 1, WALL);            // `-` 定宽 2 ⇒ 高最多 1，已到顶（右半边靠盘边）
  const got = fired(st, 'R3');
  onlyEdges('`-` 定宽 2、高已到上限 ⇒ 上下四条边封墙', got,
    [[ix(3, 1, 1), 0, WALL], [ix(3, 1, 2), 0, WALL], [ix(3, 1, 1), 2, WALL], [ix(3, 1, 2), 2, WALL]]);
  hasReason(got, ix(3, 1, 1), 0, /`-` 宽定死为 2，高最多 1，已到上限不能再长高/, 'R3 定宽');
  eq('R3 这一步不报矛盾', badOf(st).length, 0);
}
{
  const st = createSt(3, 2, [M(1, 1, T_SQUARE)]);
  putEdge(st, ix(3, 1, 1), 1, SAME);
  putEdge(st, ix(3, 1, 1), 3, WALL);
  putEdge(st, ix(3, 1, 2), 0, WALL);            // `+` 定宽 2、还差 1 高，缺口只剩一个
  const got = fired(st, 'R3');
  ok('`+` 只能朝唯一缺口长', got.some((f) => f.i === ix(3, 1, 1) && f.dir === 0 && f.want === SAME),
    `实得 [${keysOf(got)}]`);
  hasReason(got, ix(3, 1, 1), 0, /高还差 1，而唯一能长的缺口是 \(1,1\) 的上侧/, 'R3 逼长');
}
{
  const st = createSt(3, 3, [M(0, 0, T_SQUARE)]);
  putEdge(st, ix(3, 0, 0), 2, SAME);
  putEdge(st, ix(3, 0, 0), 1, WALL);
  putEdge(st, ix(3, 1, 0), 1, WALL);            // `+` 定宽 1，高却已有 2
  fired(st, 'R3');
  hasBad('`+` 宽定死却已经长过头 ⇒ 矛盾', st, 'R3 区域尺寸推理', /`\+` 宽已定死为 1，高却已有 2/);
}

// ---- R4 定形封闭（R3 的分支）
{
  // 外接框 2×2 已封死、块内还差一格：那格只能并进来，框外只能成墙
  const st = createSt(3, 3, [M(1, 1, T_SQUARE)]);
  const seed = [[ix(3, 1, 1), 1, SAME], [ix(3, 1, 1), 2, SAME], [ix(3, 1, 2), 1, WALL],
    [ix(3, 1, 1), 3, WALL], [ix(3, 2, 1), 3, WALL], [ix(3, 1, 1), 0, WALL], [ix(3, 1, 2), 0, WALL],
    [ix(3, 2, 1), 2, WALL]];
  for (const [i, d, v] of seed) putEdge(st, i, d, v);
  const got = fired(st, 'R3');
  onlyEdges('L 形的框只能补成 2×2（框的四侧本来就都封住了）', got,
    [[ix(3, 1, 2), 2, SAME], [ix(3, 2, 1), 1, SAME]]);
  ok('R4 是 R3 的分支：这两条都记在 R4 名下',
    got.every((f) => f.rule === 'R4 定形封闭'), JSON.stringify(got.map((f) => f.rule)));
  hasReason(got, ix(3, 1, 2), 2, /框内必须连成一块/, 'R4 封闭');
  eq('R4 封闭后不产生矛盾', badOf(st).length, 0);
}
{
  // 补进框里的那一格自己也有边界：它的**左、上**侧同样必须成墙。
  // sealBox 早先只走右与下，这条墙就凭空少一面（4×4 这盘的 (2,1) 左侧是实测抓出来的）。
  const st = createSt(4, 4, [M(1, 1, T_SQUARE)]);
  const seed = [[5, 1, SAME], [6, 2, SAME],                        // L 形：缺 (2,1)
    [5, 3, WALL], [6, 1, WALL], [10, 1, WALL], [5, 0, WALL], [6, 0, WALL], [10, 2, WALL]];
  for (const [i, d, v] of seed) putEdge(st, i, d, v);
  const got = fired(st, 'R3');
  onlyEdges('补进来的 (2,1) 四周：内侧打通、外侧成墙', got,
    [[5, 2, SAME], [9, 1, SAME], [9, 2, WALL], [9, 3, WALL]]);
  eq('这一步不报矛盾', badOf(st).length, 0);
  hasReason(got, 9, 3, /框外不得并入/, 'R4 补格的外侧');
}
{
  // 定形成 2×1，记号却是 `+` ⇒ 形状与记号不符
  const st = createSt(3, 3, [M(1, 1, T_SQUARE)]);
  for (const [i, d] of [[ix(3, 1, 1), 3], [ix(3, 1, 2), 1], [ix(3, 1, 1), 0], [ix(3, 1, 2), 0],
    [ix(3, 1, 1), 2], [ix(3, 1, 2), 2]]) putEdge(st, i, d, WALL);
  putEdge(st, ix(3, 1, 1), 1, SAME);
  fired(st, 'R3');
  hasBad('定形 2×1 却挂着 `+` ⇒ 矛盾', st, 'R4 定形封闭', /定形为 2×1[\s\S]*记号 `\+` 要求宽=高/);
}
{
  // 数记号必须数**框**：框里压着第二个记号，连通块却只有一个
  const st = createSt(3, 3, [M(1, 1, T_SQUARE), M(1, 2, T_SQUARE)]);
  for (const [i, d] of [[ix(3, 1, 1), 3], [ix(3, 1, 2), 1], [ix(3, 1, 1), 0], [ix(3, 1, 2), 0],
    [ix(3, 1, 1), 2], [ix(3, 1, 2), 2]]) putEdge(st, i, d, WALL);
  putEdge(st, ix(3, 1, 1), 1, SAME);
  fired(st, 'R3');
  hasBad('定形框里数记号要数框，不是数连通块', st, 'R4 定形封闭', /定形为 2×1，框里却有 2 个记号/);
}

// ---- R5 记号可达
{
  const st = createSt(3, 3, [M(0, 0, T_WIDE), M(0, 2, T_TALL)]);
  putEdge(st, ix(3, 1, 1), 1, WALL);            // (1,1)|(1,2)
  putEdge(st, ix(3, 1, 2), 2, WALL);            // (1,2)|(2,2)
  const got = fired(st, 'R5');
  onlyEdges('一封就到不了任何记号的边只能打通', got, [[ix(3, 1, 2), 0, SAME], [ix(3, 2, 2), 3, SAME]]);
  hasReason(got, ix(3, 1, 2), 0, /\(1,2\) 封掉上侧就到不了任何记号/, 'R5');
}

// ---- R6 候选形状收敛
{
  const markers = [M(0, 0, T_WIDE), M(0, 3, T_WIDE)];
  const st = createSt(4, 1, markers);
  const got = fired(st, 'R6');
  onlyEdges('1×4 两端各一个 `-`：靠边的两对只能同块', got, [[0, 1, SAME], [2, 1, SAME]]);
  hasReason(got, 0, 1, /`-` \(0,0\) 的 2 种可能形状都同时包含 \(0,0\) 和 \(0,1\)/, 'R6');
  eq('R6 这一步不报矛盾', badOf(st).length, 0);
  eq('`-` (0,0) 的候选恰好两种：(0,0)-(0,1) 与 (0,0)-(0,2)，铺满整行那种会吞掉对面的 `-`',
    candsBrute(st, 0).join(' '), '0:0:0:1 0:0:0:2');
  eq('R6 与"逐格扫"的独立参照给出的边集相同',
    edgeSet(got.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(4, 1, markers)));
  const r = solve(4, 1, markers);
  ok('这盘整条通道推得完，且推完就是合法解', r.solved && r.unknownEdges === 0,
    `solved=${r.solved} 剩余=${r.unknownEdges}`);
  eq('推得完 ⇒ 计数器限 2 数到 1', countAnchored(4, 1, markers, { limitSolutions: 2 }).sols, 1);
}
{
  // 候选必须"恰好含这一个记号"。少了这条守门，`-` 会把自己算成 1×2 吞掉旁边的 `+`
  const markers = [M(0, 0, T_WIDE), M(0, 1, T_SQUARE)];
  const st = createSt(2, 1, markers);
  const got = fired(st, 'R6');
  onlyEdges('候选不许跨记号 ⇒ `+` 那格与 `-` 那格之间只能是墙', got, [[0, 1, WALL]]);
  hasBad('`-` 在此处无任何合法候选 ⇒ 矛盾', st, 'R6 候选形状收敛',
    /`-` \(0,0\) 已经长不出任何合法矩形：候选为空/);
  eq('跨记号的矩形确实被候选表挡掉了：`-` 的候选数 0', candsBrute(st, 0).length, 0);
  eq('`+` 的候选只剩它自己那一格', candsBrute(st, 1).join(' '), '0:1:0:1');
  eq('R6 与独立参照给出的边集相同（跨记号例）',
    edgeSet(got.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(2, 1, markers)));
  // 这条墙不能同时以"格 1 的左侧"再记一遍，否则同一面墙有两张名字
  eq('R6 只用"右/下"记边', got.filter((f) => f.dir === 0 || f.dir === 3).length, 0);
}
{
  const markers = [M(1, 1, T_SQUARE)];
  // 三面墙掐掉左上、右上、左下三个 2×2 候选，`+` 只剩"1×1"与"右下 2×2"两种可能
  const seeds = [[0, 1], [2, 2], [3, 2]].map(([i, d]) => [i, d, WALL]);
  const st = createSt(3, 3, markers);
  for (const [i, d, v] of seeds) putEdge(st, i, d, v);
  const got = fired(st, 'R6');
  // 名字里那句"候选只剩两种"必须自己站得住：逐格扫一遍给它数出来
  eq('三面墙之后 `+` 的候选只剩它自己 (1,1)-(1,1) 与右下的 (1,1)-(2,2)', candsBrute(st, 0).join(' '),
    '1:1:1:1 1:1:2:2');
  eq('两个候选的逐格覆盖数（(1,1) 两个都要，(1,0) 一个都不要）',
    containBrute(3, 3, candsBrute(st, 0)).join(','), '0,0,0,0,2,1,0,1,1');
  // 这两条墙记录在对面那一格上：每条边只看一次（i 的右、下）
  onlyEdges('候选只剩两种 ⇒ 上方与左方各封一面墙', got, [[3, 1, WALL], [1, 2, WALL]]);
  eq('R6 与独立参照给出的边集相同（这一例）',
    edgeSet(got.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(3, 3, markers, seeds)));
  hasReason(got, 3, 1, /`\+` \(1,1\) 无论长成哪种形状，\(1,0\) 与 \(1,1\) 都不会同属一块/,
    'R6 逼出墙');
  hasReason(got, 1, 2, /`\+` \(1,1\) 无论长成哪种形状，\(0,1\) 与 \(1,1\) 都不会同属一块/,
    'R6 逼出墙');
  eq('墙也只记在"右/下"这一侧：没有第 3、0 方向的断言',
    got.filter((f) => f.dir === 0 || f.dir === 3).length, 0);
}
{
  // 反面：只掐一面墙时"左下 2×2"还是合法候选，那条边就**不是**墙。
  // 少这条断言，前面那例的"逼出墙"就退化成"数错了候选也能过"。
  const markers = [M(1, 1, T_SQUARE)];
  const seeds = [[0, 1, WALL]];
  const st = createSt(3, 3, markers);
  for (const [i, d, v] of seeds) putEdge(st, i, d, v);
  const got = fired(st, 'R6');
  onlyEdges('左上候选被掐掉，但左下候选还活着 ⇒ 一条都逼不出来', got, []);
  eq('此刻 `+` 有 4 个候选（自己 + 右上、左下、右下那三个 2×2；只有左上被掐掉）',
    candsBrute(st, 0).length, 4);
  eq('R6 与独立参照给出的边集相同（不作为这一例）',
    edgeSet(got.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(3, 3, markers, seeds)));
}
{
  // 候选不许穿过已知墙：穿过去的矩形不是"这块可能长成的形状"。
  // 竖盘 1×4 两端各一个 `|`，中段一面墙把两边切开：R6 只能在墙的同侧说话。
  const markers = [M(0, 0, T_TALL), M(3, 0, T_TALL)];
  const seeds = [[1, 2, WALL]];                       // (1,0)|(2,0)
  const st = createSt(1, 4, markers);
  for (const [i, d, v] of seeds) putEdge(st, i, d, v);
  const got = fired(st, 'R6');
  onlyEdges('竖盘中段一面墙：两端各自收敛，墙两侧不得被打通', got,
    [[0, 2, SAME], [2, 2, SAME]]);
  eq('墙把 `|` (0,0) 的候选切到只剩竖着的 (0,0)-(1,0)', candsBrute(st, 0).join(' '), '0:0:1:0');
  eq('没有任何断言落在那面已知墙上', got.filter((f) => f.i === 1 && f.dir === 2).length, 0);
  eq('R6 与独立参照给出的边集相同（跨墙例）',
    edgeSet(got.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(1, 4, markers, seeds)));
}

// ---- R7 孤岛记号数
{
  const st = createSt(3, 3, [M(0, 0, T_WIDE)]);
  const got = fired(st, 'R7');
  eq('整盘一个记号 ⇒ 12 条内部边全部打通', got.length, 12);
  ok('R7 的断言全是"同块"且都记在自己名下',
    got.every((f) => f.want === SAME && f.rule === 'R7 孤岛记号数'));
  hasReason(got, ix(3, 2, 1), 1, /只有 `-` \(0,0\) 一个记号，岛上的格子只能归它/, 'R7');
  const v = verdict(st);
  ok('推完 ≠ 推对：整盘并成 3×3 挂 `-`，方向复核必须拦下',
    v.complete && v.regions === 1 && v.oneMarkerEach && !v.aspect, JSON.stringify(v));
}
{
  const st = createSt(3, 3, [M(0, 0, T_WIDE)]);
  putEdge(st, ix(3, 2, 1), 1, WALL);
  putEdge(st, ix(3, 1, 2), 2, WALL);
  fired(st, 'R7');
  hasBad('被墙围死却一个记号都没有的一片 ⇒ 矛盾', st, 'R7 孤岛记号数',
    /\(2,2\) 所在的一片已经被墙围死，里面一个记号都没有/);
}

// ---- 规则之间不得顶包：空盘上只有该开口的规则开口
{
  // 每条规则各拿一份**干净**的空盘：跑过 R2 的状态再喂给 R1 就说不清是谁闭的嘴。
  const mk = () => createSt(3, 3, [M(0, 0, T_WIDE), M(2, 2, T_WIDE)]);
  eq('空盘上 R2 一条都推不出（每个格点都还剩多种许可构型）', fired(mk(), 'R2').length, 0);
  eq('记号不相邻时 R1 一条都推不出', fired(mk(), 'R1').length, 0);
  eq('两个记号都在同一个岛里时 R7 推不出归属', fired(mk(), 'R7').length, 0);
  eq('空盘上 R5 也推不出：封掉任何一条边都还有别的路绕到记号', fired(mk(), 'R5').length, 0);
  eq('空盘上 R3 推不出：还没有任何区域被两侧夹住', fired(mk(), 'R3').length, 0);
  const st6 = mk();
  const got6 = fired(st6, 'R6');
  ok('R6 是空盘上唯一能开口的：只看一个记号自己可能长成哪些矩形',
    got6.length > 0 && got6.every((f) => f.want === SAME), JSON.stringify(got6.map((f) => [f.i, f.dir, f.want])));
  eq('R6 在空盘上的断言与独立参照同集',
    edgeSet(got6.map((f) => `${f.i},${f.dir},${f.want}`)), edgeSet(r6Brute(3, 3, st6.markers)));
}

// ================================================== C)+D) 真值审计与强度差
console.log('\n== C) 真值逐条审计 + D) 强度差与推完率 ==');

/**
 * 样本集的身份 + 逐档计数。
 * `digest` 只覆盖"哪些盘、哪些记号、真值划分是什么"，与求解器无关 ⇒ 它是夹具的指纹，
 * 不是实得值：换种子、换 mulberry32、换 sampleBoard 都会先在这里红。
 * `uniq` 由独立计数器给出（另一条通道），`closed`/`uniqNotClosed` 是铅笔通道的**哨兵**：
 * 它们不是承诺（承诺是下面那几条 0 与蕴含方向），而是"这批样本没被悄悄换掉、
 * 强度没偷偷退化"的绊线；动了它必须先说清动了什么，不许顺手改成实得值。
 */
const FIXTURE = {
  '4×4': { digest: '4f547ac3', boards: 40, uniq: 19, closed: 10, uniqNotClosed: 9 },
  '6×6': { digest: 'eab9dcbe', boards: 60, uniq: 10, closed: 2, uniqNotClosed: 8 },
  '8×8': { digest: '6ee1b4aa', boards: 40, uniq: 2, closed: 0, uniqNotClosed: 2 },
  '10×10': { digest: 'eea1c795', boards: 25, uniq: 1, closed: 0, uniqNotClosed: 1 },
};

function audit(w, h, n) {
  const R = {
    w, h, tag: `${w}×${h}`, boards: 0, viol: 0, contradicted: 0, closed: 0, uniq: 0,
    uniqNotClosed: 0, layoutBad: 0, legalBad: 0, truthBad: 0, budgetHit: 0, edgeMathBad: 0,
    dupFacts: 0, r6Facts: 0, r6Viol: 0, r6Extra: 0, r6Miss: 0, coverDisagree: 0, key: '',
  };
  const ruleUse = {};
  const left = [], passesClosed = [], dedClosed = [], proofNodes = [];
  const samples = [];
  const totalEdges = (w - 1) * h + w * (h - 1);
  /** 一条断言（i,dir,want）在真值分块里成不成立。 */
  const trueAgainst = (f, lab) => {
    const j = f.dir === 0 ? f.i - w : f.dir === 2 ? f.i + w : f.dir === 1 ? f.i + 1 : f.i - 1;
    if (j < 0 || j >= w * h) return true;      // 盘外方向不参与判定（claim 本就不会往盘外记边）
    return (f.want === SAME) === (lab[f.i] === lab[j]);
  };

  for (let k = 0; k < n; k++) {
    const b = sampleBoard(w, h, boardSeed(w, h, k));
    if (!b) { samples.push({ 盘: k, 生成失败: true }); continue; }
    R.boards++;
    R.key += `${k}:${b.markers.map((m) => `${m.r},${m.c},${MARKER_CHAR[m.type]}`).join(' ')}|${canon(b.lab)};`;

    // 真值自己先要站得住：样本盘过 rules.js 整盘检查，且 lab 与 rects 是同一个划分
    const rectsFromLab = rectsOf(Int32Array.from(b.lab), w, h);
    const fmt = (rs) => rs.map((p) => `${p.r0},${p.c0},${p.r1},${p.c1}`).sort().join(' ');
    if (invalidReason(w, h, b.markers, b.rects) !== null || !rectsFromLab ||
      fmt(rectsFromLab) !== fmt(b.rects)) {
      R.truthBad++;
      if (samples.length < 4) samples.push({ 盘: k, 真值不合法: invalidReason(w, h, b.markers, b.rects) });
      continue;
    }

    const r = solve(w, h, b.markers);
    // 恒等式：每条断言恰好定住一条原先未知的边 ⇒ 剩余未知 = 总内部边 − 断言数。
    // 不成立就说明 unknownEdges 不是它的名字所说的东西（难度分数的原料也就废了）。
    if (totalEdges - r.deductions !== r.unknownEdges) R.edgeMathBad++;
    for (const f of r.facts) if (!trueAgainst(f, b.lab)) {
      R.viol++;
      if (samples.length < 4) {
        samples.push({ 盘: k, 规则: f.rule, 断言: `${f.i}→${f.dir}=${f.want}`, 理由: f.reason });
      }
    }
    for (const [name, cnt] of Object.entries(r.ruleUse)) ruleUse[name] = (ruleUse[name] || 0) + cnt;
    if (r.contradictions.length) {
      R.contradicted++;
      if (samples.length < 6) samples.push({ 盘: k, 矛盾: r.contradictions[0] });
    }

    // R6 单独从空盘跑：断言逐条对真值，边集整份对"逐格扫"的独立参照。
    // 这条专抓"凭空造出跨记号 / 跨已知墙的候选"——它比的是集合相等，双向都抓。
    const g6 = fired(createSt(w, h, b.markers), 'R6');
    const exp6 = r6Brute(w, h, b.markers);
    const gs6 = new Set(g6.map((f) => `${f.i},${f.dir},${f.want}`));
    if (gs6.size !== g6.length) R.dupFacts++;
    R.r6Facts += g6.length;
    for (const x of gs6) if (!exp6.has(x)) R.r6Extra++;
    for (const x of exp6) if (!gs6.has(x)) R.r6Miss++;
    for (const f of g6) if (!trueAgainst(f, b.lab)) R.r6Viol++;

    const u = countAnchored(w, h, b.markers, { limitSolutions: 2, nodeBudget: 3e6 });
    proofNodes.push(u.nodes);
    if (u.stopped) R.budgetHit++;               // 击穿预算 ⇒ sols 只是下界，不能当证词
    const isUniq = !u.stopped && u.sols === 1;
    if (isUniq) R.uniq++;
    if (isUniq && !r.solved) R.uniqNotClosed++;
    // 唯一性判定换一条独立实现（MRV 精确覆盖）再问一遍：两套搜索不许对同一张盘给不同证词
    if (w <= 6) {
      const uc = countCover(w, h, b.markers, { limitSolutions: 2, nodeBudget: 3e6 });
      if (!uc.stopped && uc.sols !== u.sols) R.coverDisagree++;
    }
    if (r.solved) {
      R.closed++;
      passesClosed.push(r.passes);
      dedClosed.push(r.deductions);
      if (canon(r.verdict.lab) !== canon(b.lab)) R.layoutBad++;
      if (invalidReason(w, h, b.markers, rectsOf(Int32Array.from(r.verdict.lab), w, h)) !== null) R.legalBad++;
      ok(`${w}×${h} #${k} 推得完必须蕴含计数器唯一`, isUniq, `sols=${u.sols} stopped=${u.stopped}`);
    } else if (!r.contradictions.length) left.push(r.unknownEdges);
  }

  console.log(`  ${R.tag}：盘 ${R.boards} · 违规断言 ${R.viol} · 有矛盾 ${R.contradicted} · ` +
    `推完 ${R.closed} · 唯一 ${R.uniq} · 唯一但推不完 ${R.uniqNotClosed}`);
  console.log(`     R6 单跑 ${R.r6Facts} 条断言 · 违规 ${R.r6Viol} · 越权 ${R.r6Extra} · 漏权 ${R.r6Miss}`);
  console.log(`     卡住时剩余未知边 中位=${q(left, 0.5)} p95=${q(left, 0.95)} · ` +
    `推完轮次 p95=${q(passesClosed, 0.95)} · 推完断言数 p95=${q(dedClosed, 0.95)} · ` +
    `证词节点 p95=${q(proofNodes, 0.95)} 最大=${proofNodes.length ? Math.max(...proofNodes) : '—'}`);
  for (const s of samples) console.log('     ' + JSON.stringify(s));
  R.ruleUse = ruleUse;
  R.digest = fnv(R.key);
  return R;
}

const rows = [audit(4, 4, 40), audit(6, 6, 60), audit(8, 8, 40), audit(10, 10, 25)];

for (const r of rows) {
  const f = FIXTURE[r.tag];
  // ---- 夹具身份：先确认"测的是哪批盘"，再谈"这批盘上测到了什么"
  eq(`${r.tag} 样本集指纹（盘数 + 记号 + 真值划分，与求解器无关）`, r.digest, f.digest);
  eq(`${r.tag} 取到的盘数`, r.boards, f.boards);
  ok(`${r.tag} 样本盘张张过 rules.js 整盘合法检查（含 lab 与 rects 同划分）`, r.truthBad === 0,
    `不合法 ${r.truthBad}`);
  // ---- 正确性：这才是承诺
  eq(`${r.tag} 真值审计：违规断言 0 条`, r.viol, 0);
  eq(`${r.tag} 合法真值盘上一条矛盾都不该有`, r.contradicted, 0);
  eq(`${r.tag} 推完的盘与真值是同一个划分`, r.layoutBad, 0);
  eq(`${r.tag} 推完的盘过 rules.js 整盘复核`, r.legalBad, 0);
  eq(`${r.tag} R6 单跑的断言在真值里一条都没落错`, r.r6Viol, 0);
  eq(`${r.tag} R6 不许凭空造出跨记号／跨墙的候选（越权条数）`, r.r6Extra, 0);
  eq(`${r.tag} R6 也不许漏掉独立参照推出的候选收敛（漏权条数）`, r.r6Miss, 0);
  eq(`${r.tag} R6 的断言不重复记同一条边`, r.dupFacts, 0);
  eq(`${r.tag} unknownEdges 恒等于"内部边总数 − 断言数"`, r.edgeMathBad, 0);
  eq(`${r.tag} 限 2 的证词一次都没击穿节点预算`, r.budgetHit, 0);
  eq(`${r.tag} 唯一性判定与 MRV 精确覆盖式同调（分歧盘数）`, r.coverDisagree, 0);
  // ---- 蕴含方向 + 强度
  ok(`${r.tag} 推完率不超过唯一解率`, r.closed <= r.uniq, `${r.closed} > ${r.uniq}`);
  eq(`${r.tag} 唯一解盘数（独立计数器在这批样本上数到的）`, r.uniq, f.uniq);
  eq(`${r.tag} 铅笔推完的盘数【哨兵】`, r.closed, f.closed);
  eq(`${r.tag} 唯一但推不完的盘数【哨兵】`, r.uniqNotClosed, f.uniqNotClosed);
}
const ruleUseTotal = rows.reduce((a, r) => {
  for (const [k, v] of Object.entries(r.ruleUse)) a[k] = (a[k] || 0) + v;
  return a;
}, {});
const ruleUseKey = Object.keys(ruleUseTotal).sort().map((k) => `${k}=${ruleUseTotal[k]}`).join(' ');
console.log('  规则使用合计：' + ruleUseKey);
eq('规则使用合计【哨兵：每条命名规则在这批样本上各开口多少次】', fnv(ruleUseKey), '88ce3930');
ok('简单档有货：4×4 至少 1 张铅笔推得完', rows[0].closed >= 1, `${rows[0].closed}`);
ok('6×6 至少 1 张推得完', rows[1].closed >= 1, `${rows[1].closed}`);
ok('强度差是真的：6×6 有唯一解但铅笔推不完的盘', rows[1].uniqNotClosed >= 1, `${rows[1].uniqNotClosed}`);
ok('强度差在 8×8 也存在', rows[2].uniqNotClosed >= 1, `${rows[2].uniqNotClosed}`);
ok('每一档都有 R6 单跑能说上话的盘（候选收敛不是空转）',
  rows.every((r) => r.r6Facts > 0), rows.map((r) => `${r.tag}:${r.r6Facts}`).join(' '));

console.log('\n== 提示通道：每步都点名一条规则 ==');
{
  const b = sampleBoard(6, 6, 12345);
  ok('这张提示用盘取到了', !!b);
  const st = createSt(6, 6, b.markers);
  const added = step(st);
  ok('空盘第一步就有可说的（提示不会开局就哑）', added > 0, `added=${added}`);
  eq('第一步说出的条数【哨兵】', added, 19);
  ok('每条断言都带规则名和一句人话',
    st.facts.every((f) => /^R[1-7] /.test(f.rule) && f.reason.length > 8),
    JSON.stringify(st.facts.slice(0, 2)));
  const r = solve(6, 6, b.markers);
  // 推不完的盘才谈得上"剩余未知边"：这里不许是恒真式（推完时它是 0，推不完时必须 > 0）
  eq('这张 6×6 样本盘铅笔推不完（所以才需要难度分数）', r.solved, false);
  ok('停不下来的盘给出剩余未知边数 > 0', r.unknownEdges > 0, `unknown=${r.unknownEdges}`);
  eq('剩余未知边 = 内部边总数 − 断言数（同一状态两种数法）',
    r.unknownEdges, (6 - 1) * 6 + 6 * (6 - 1) - r.deductions);
  eq('这张盘的剩余未知边数【哨兵：难度分数的原料】', r.unknownEdges, 38);
  ok('推不完的盘也交得出"还剩哪几条边"的账（每条未知边都是 UNKNOWN 而不是猜的）',
    r.verdict.complete === false && r.unknownEdges > 0, JSON.stringify({ c: r.verdict.complete }));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
