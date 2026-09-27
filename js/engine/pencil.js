// 铅笔求解器 · 只用人能命名的局部推理
//
// 这条通道和计数器分工不同：计数器**允许搜索**（挑一个矩形放进去），
// 人不允许。人只准在已经画下的线上说"这一条**必须**是墙 / 必须打通"，
// 并且每一步都讲得出理由。所以本文件里没有 DFS、没有回溯、没有"先猜一个"。
//
// 三条后果，都是这套约定的义务而不是装饰：
//   1. 出货的盘必须能被本通道从空盘推完 —— 那才是"零猜测"的实际含义。
//   2. 本通道**比计数器弱**是设计目标：推不动的盘正是难度所在，
//      强弱差就是难度分数（对照 `证词` 的 propagate() vs countModels()）。
//   3. 每一步都必须是**真的**（在所有解里都成立）。规则写错的方向只能是"弱"，
//      不能是"错"，所以 tools/pencil-test.mjs 拿真值分块逐条审计，而不是只测自洽。
//
// ── 规则清单（先写全再实现，不边写边发明）────────────────────────────
// 状态表示：每条内部边三态 —— 未知 / 墙 / 同块。"同块"也是人能说出的结论
// （"这格只能并进那块 `+` 的正方形"），所以两条通道都留着。
//
// R1 记号互斥        每块恰好一个记号 ⇒ 两侧各自已有记号的区域之间必须是墙。
//                    特例：相邻两格都是记号 ⇒ 公共边是墙。
// R2 窗口构型表      一个格点四周的四格，其分块方式只能是 11 种边赋值之一
//                    （= 7 种许可划分：四格同块 / 横双 / 竖双 / 4 种"邻边配对 + 两个单格"）。
//                    被排除的 5 种：风车（四格四块，禁四角）、4 种三加一、以及
//                    "只剩两条对角同块"这种填不满外接框的写法。
//                    这条表由 rule-test 的穷举给出，本文件只查表不重新发明。
// R3 区域尺寸推理    某区域在左右（或上下）两侧都涨不出去 ⇒ 宽（高）就此定死，
//                    于是记号的方向约束直接给出另一维的取值：
//                      `-` 定宽 W ⇒ 高最多 W-1；已等于 W-1 ⇒ 上下全部成墙
//                      `|` 定高 H ⇒ 宽最多 H-1；已等于 H-1 ⇒ 左右全部成墙
//                      `+` 定宽 W ⇒ 高**必须**是 W：大了矛盾，正好 ⇒ 另一侧封墙，
//                         还不够 ⇒ 只能朝唯一可长的方向打通
//                    对侧同理。"必须长但只有一个候选缺口"就强制同块，多缺口则不强制。
// R4 定形封闭        宽高同时定死 ⇒ 该区域**恰好**是它的外接框：
//                    框内边全打通、框外边全成墙；形状不合法或框内有别人的墙就是矛盾。
//                    记号按**框**数：框里 0 个或 ≥2 个都矛盾。按连通块数会误报——
//                    框内还可能压着一个尚未并进来的记号（这条被真值审计抓到过一次）。
// R5 记号可达        任何一格最终都属于某个含记号的区域。若某格的某条未知边一封成墙
//                    它就再也走不到任何记号 ⇒ 那条边必须打通。
// R6 候选形状收敛    单看一个记号：把所有"不跨已知墙、不含别的记号、方向相符"的矩形列出来，
//                    真解里它那一块必然就在这张表里。于是
//                      每个候选都含的两格 ⇒ 它们之间必须打通；
//                      一块必含的格与一个任何候选都不要的格相邻 ⇒ 之间必须是墙。
//                    这条只枚举**一个记号自己**的形状，不做多记号的组合试探。
// R7 孤岛记号数      不跨墙可达的一片格子叫孤岛。岛上的格只能属于岛上的记号，
//                    所以岛里有 0 个记号 = 矛盾，恰好 1 个 = 全岛都是它那一块 ⇒ 岛内边全打通
//                    （下一轮 R3/R4 立刻判它是不是长方形）。这条就是"整盘只有一个记号"那种
//                    人一眼看完的开局。
//
// 明确**没有**的规则（留给下一轮按实测决定要不要加，而不是现在发明）：
// 跨多个记号的组合枚举、任何形式的"先猜一条墙再看会不会矛盾"。
// ─────────────────────────────────────────────────────────────────

import { isRectangular, windmillPoints } from './rules.js';
import { aspectOk, checkMarkers, MARKER_CHAR, T_WIDE, T_TALL, T_SQUARE } from './counter.js';

export const UNKNOWN = 0, WALL = 1, SAME = 2;
const VAL_NAME = ['未知', '墙', '同块'];
const DIR_NAME = ['上', '右', '下', '左'];

/** 内部边槽：dir 0上 1右 2下 3左。返回 null 表示盘外（视作边界墙）。 */
function slot(st, i, dir) {
  const { w, h } = st;
  const c = i % w, r = (i / w) | 0;
  if (dir === 0) return r > 0 ? { arr: st.down, k: i - w } : null;
  if (dir === 2) return r < h - 1 ? { arr: st.down, k: i } : null;
  if (dir === 1) return c < w - 1 ? { arr: st.right, k: i } : null;
  return c > 0 ? { arr: st.right, k: i - 1 } : null;
}

function nb(st, i, dir) {
  const { w } = st;
  const s = slot(st, i, dir);
  if (!s) return -1;
  return dir === 0 ? i - w : dir === 2 ? i + w : dir === 1 ? i + 1 : i - 1;
}

export function cellName(st, i) {
  return `(${(i / st.w) | 0},${i % st.w})`;
}

/** 下一条断言：把 (i,dir) 的边定为 want。已经相反 ⇒ 记一条矛盾，而不是静默覆盖。 */
function claim(st, i, dir, want, rule, reason) {
  const s = slot(st, i, dir);
  if (!s) {
    if (want === SAME) {
      st.contradictions.push({ rule, detail: `${cellName(st, i)} 的${DIR_NAME[dir]}侧是盘外，但${reason}` });
    }
    return 0;
  }
  const cur = s.arr[s.k];
  if (cur === want) return 0;
  if (cur !== UNKNOWN) {
    st.contradictions.push({
      rule,
      detail: `${cellName(st, i)}${DIR_NAME[dir]}侧已是${VAL_NAME[cur]}，与"${VAL_NAME[want]}"冲突：${reason}`,
    });
    return 0;
  }
  s.arr[s.k] = want;
  st.facts.push({ rule, i, dir, want, reason });
  return 1;
}

/** 玩家画线（与测试台播种）的入口：直接改一条边，不记推理账、也不报错。 */
export function putEdge(st, i, dir, val) {
  const s = slot(st, i, dir);
  if (!s) return false;
  s.arr[s.k] = val;
  return true;
}

export function createSt(w, h, markers) {
  const N = w * h;
  const st = {
    w, h, N, markers,
    markerAt: new Int32Array(N).fill(-1),
    right: new Uint8Array(N),   // right[i]：i 与 i+1 之间（i 不在最后一列时有效）
    down: new Uint8Array(N),    // down[i]：i 与 i+w 之间
    facts: [],
    contradictions: [],
  };
  checkMarkers(w, h, markers, st.markerAt);
  return st;
}

/** SAME 边诱导的连通块。每轮重算：≤100 格，换来的是规则里不出现"维护"这个词。 */
export function components(st) {
  const { w, N } = st;
  const comp = new Int32Array(N).fill(-1);
  const groups = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] >= 0) continue;
    const id = groups.length;
    const cells = [i];
    comp[i] = id;
    for (let p = 0; p < cells.length; p++) {
      const c = cells[p];
      for (let d = 0; d < 4; d++) {
        const j = nb(st, c, d);
        if (j < 0 || get(st, c, d) !== SAME) continue;
        if (comp[j] >= 0) continue;
        comp[j] = id;
        cells.push(j);
      }
    }
    groups.push(cells);
  }
  const markerOf = groups.map((cells) => {
    let mi = -1, cnt = 0;
    for (const c of cells) if (st.markerAt[c] >= 0) { if (cnt === 0) mi = st.markerAt[c]; cnt++; }
    return { mi, cnt };
  });
  return { comp, groups, markerOf, w };
}

function get(st, i, dir) {
  const s = slot(st, i, dir);
  return s ? s.arr[s.k] : WALL;
}

// ---------------------------------------------------------------- R1 记号互斥
/** 记号 id → 字符。MARKER_CHAR 按**类型**下标，别拿记号序号去索引它。 */
function ch(st, mi) {
  return MARKER_CHAR[st.markers[mi].type];
}

function r1(st, G) {
  let n = 0;
  const { groups, markerOf, comp } = G;
  for (let i = 0; i < st.N; i++) {
    for (const d of [1, 2]) {
      if (get(st, i, d) !== UNKNOWN) continue;
      const j = nb(st, i, d);
      const ci = comp[i], cj = comp[j];
      if (ci === cj) continue;
      const a = markerOf[ci], b = markerOf[cj];
      if (a.cnt === 0 || b.cnt === 0) continue;
      const reason = (st.markerAt[i] >= 0 && st.markerAt[j] >= 0)
        ? `两侧各有一个记号（\`${ch(st, st.markerAt[i])}\`、\`${ch(st, st.markerAt[j])}\`），一块只能领一个`
        : `${cellName(st, i)} 所在的块已含记号 \`${ch(st, a.mi)}\`，${cellName(st, j)} 所在的块已含记号 \`${ch(st, b.mi)}\``;
      n += claim(st, i, d, WALL, 'R1 记号互斥', reason);
    }
  }
  for (let g = 0; g < groups.length; g++) {
    if (markerOf[g].cnt > 1) {
      st.contradictions.push({
        rule: 'R1 记号互斥',
        detail: `一块里被打通进了 ${markerOf[g].cnt} 个记号，而每块恰好一个`,
      });
    }
  }
  return n;
}

// ---------------------------------------------------------------- R2 窗口构型表
// 四格编号 0=NW 1=NE 2=SW 3=SE；四条边 A=NW|NE(右)、B=NW|SW(下)、C=SW|SE(右)、D=NE|SE(下)。
// 掩码位：bit0=A bit1=B bit2=C bit3=D，置位表示该边"同块"。
const PAIR_ADJ = new Set(['0,1', '0,2', '2,3', '1,3']);

function windowClasses(mask) {
  const p = [0, 1, 2, 3];
  const find = (x) => (p[x] === x ? x : (p[x] = find(p[x])));
  const union = (a, b) => { p[find(a)] = find(b); };
  if (mask & 1) union(0, 1);
  if (mask & 2) union(0, 2);
  if (mask & 4) union(2, 3);
  if (mask & 8) union(1, 3);
  const by = new Map();
  for (let i = 0; i < 4; i++) {
    const k = find(i);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  }
  return [...by.values()];
}

/**
 * 四格区域号 → 等值掩码（bit0=NW|NE、bit1=NW|SW、bit2=SW|SE、bit3=NE|SE 同块）。
 * 从**已完成的分块**读出来的掩码总是传递闭包后的形状，所以它只有 8 种取值；
 * 求解器手里的掩码可以是 11 种（还带着"未定"）。两种视图对答案见 pencil-test 的 A 节。
 */
export function equalMask([nw, ne, sw, se]) {
  let m = 0;
  if (nw === ne) m |= 1;
  if (nw === sw) m |= 2;
  if (sw === se) m |= 4;
  if (ne === se) m |= 8;
  return m;
}

/**
 * 许可窗口 = 划分本身在长方形分块里能出现，且不是风车。
 * 三加一填不满外接框、两对只能邻边配对、四格四块被禁四角挡掉。
 */
export function windowAllowed(mask) {
  const cls = windowClasses(mask);
  if (cls.length === 1) return true;
  if (cls.length === 4) return false;                       // 风车
  if (cls.some((c) => c.length === 3)) return false;        // 3+1：L 形填不满外接框
  return cls.every((c) => c.length === 1 || PAIR_ADJ.has(c.join(',')));
}

export const WINDOW_OK = (() => {
  const ok = [];
  for (let m = 0; m < 16; m++) if (windowAllowed(m)) ok.push(m);
  return ok;
})();

export function windowConfigName(mask) {
  const cls = windowClasses(mask);
  if (cls.length === 1) return '四格同属一块（点落在块内部）';
  if (cls.length === 2) {
    const [a] = cls;
    return a.includes(0) && a.includes(1) ? '上下两块横切' : '左右两块竖切';
  }
  const pair = cls.find((c) => c.length === 2);
  const side = { '0,1': '上两格', '2,3': '下两格', '0,2': '左两格', '1,3': '右两格' }[pair.join(',')];
  return `T 形连接：${side}同块，另两格各一块`;
}

const CELL_NAME = ['NW', 'NE', 'SW', 'SE'];

function r2(st) {
  let n = 0;
  const { w, h } = st;
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const nw = (y - 1) * w + (x - 1);
      const refs = [
        { i: nw, d: 1 },                 // A = NW 的右
        { i: nw, d: 2 },                 // B = NW 的下
        { i: nw + w, d: 1 },              // C = SW 的右
        { i: nw + 1, d: 2 },              // D = NE 的下
      ];
      const known = refs.map((r) => get(st, r.i, r.d));
      const live = WINDOW_OK.filter((m) => refs.every((r, k) => {
        const bit = (m >> k) & 1;
        return known[k] === UNKNOWN || (known[k] === SAME) === (bit === 1);
      }));
      const point = `格点(${x},${y})`;
      if (!live.length) {
        const q = [nw, nw + 1, nw + w, nw + w + 1];
        st.contradictions.push({
          rule: 'R2 窗口构型表',
          detail: `${point} 四周的四格怎么连都不在 11 种许可构型里（四格=${q.map((i) => cellName(st, i)).join(' ')}）`,
        });
        continue;
      }
      for (let k = 0; k < 4; k++) {
        if (known[k] !== UNKNOWN) continue;
        const vals = new Set(live.map((m) => (m >> k) & 1));
        if (vals.size > 1) continue;
        const want = vals.has(1) ? SAME : WALL;
        const why = live.length === 1
          ? `${point} 只剩一种许可构型：${windowConfigName(live[0])}`
          : `${point} 的许可构型只剩 ${live.length} 种，四格不能分属四块`;
        n += claim(st, refs[k].i, refs[k].d, want, 'R2 窗口构型表', why);
      }
    }
  }
  return n;
}

// ---------------------------------------------------------- R3/R4 区域尺寸推理
function regionBox(st, cells) {
  let r0 = 1e9, r1 = -1, c0 = 1e9, c1 = -1;
  for (const i of cells) {
    const r = (i / st.w) | 0, c = i % st.w;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
  }
  return { r0, r1, c0, c1 };
}

/** 外接框**里**的记号（不是连通块里的）。定形之后框就是那块，所以数记号必须数框。 */
function markersInBox(st, box) {
  const out = [];
  for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) {
    const mi = st.markerAt[r * st.w + c];
    if (mi >= 0) out.push(mi);
  }
  return out;
}

/**
 * free[dir] = 能从该方向长出去的格（该方向的边还是未知）。
 * 四个方向都空 ⇒ 区域定死在自己的外接框里。
 */
function regionFree(st, cells, box) {
  const free = [[], [], [], []];
  for (const i of cells) {
    const r = (i / st.w) | 0, c = i % st.w;
    if (r === box.r0 && get(st, i, 0) === UNKNOWN) free[0].push(i);
    if (c === box.c1 && get(st, i, 1) === UNKNOWN) free[1].push(i);
    if (r === box.r1 && get(st, i, 2) === UNKNOWN) free[2].push(i);
    if (c === box.c0 && get(st, i, 3) === UNKNOWN) free[3].push(i);
  }
  return free;
}

/** 只能朝一个方向长、而且那个方向只剩一个缺口 ⇒ 那一口必须打通。 */
function forceGrow(st, free, dirs, rule, why) {
  const pool = dirs.flatMap((d) => free[d].map((i) => ({ i, d })));
  if (!pool.length) { st.contradictions.push({ rule, detail: why }); return 0; }
  if (pool.length > 1) return 0;
  const { i, d } = pool[0];
  return claim(st, i, d, SAME, rule, `${why}，而唯一能长的缺口是 ${cellName(st, i)} 的${DIR_NAME[d]}侧`);
}

function sealBox(st, box, rule) {
  let n = 0;
  const inBox = new Set();
  for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) inBox.add(r * st.w + c);
  for (const i of inBox) {
    // 四个方向都要看：只走右与下，就会漏掉框**左边那一列**和**上边那一行**的外墙
    for (const d of [0, 1, 2, 3]) {
      const j = nb(st, i, d);
      if (j < 0) continue;
      n += claim(st, i, d, inBox.has(j) ? SAME : WALL, rule,
        inBox.has(j) ? '该区域已经定形成这个矩形，框内必须连成一块' : '该区域定形为该矩形，框外不得并入');
    }
  }
  return n;
}

/**
 * R3（区域尺寸推理）+ R4（定形封闭），逐区域做一次。
 *
 * 每次只处理**一个**区域，并且一旦这个区域被"打通"合并过就立刻交回上层：
 * 上层传进来的 groups 是本轮开头算的，合并之后再拿它推理，会把"合并后的一半"
 * 当成一整块，凭空编出一条矛盾（4×4 第 20 号盘实测到过）。
 */
function r3(st, G) {
  let n = 0;
  for (let g = 0; g < G.groups.length; g++) {
    const mark = st.facts.length;
    n += regionReasoning(st, G, g);
    for (let p = mark; p < st.facts.length; p++) if (st.facts[p].want === SAME) return n;
  }
  return n;
}

function regionReasoning(st, G, g) {
  let n = 0;
  const { groups, markerOf } = G;
  const cells = groups[g];
  const box = regionBox(st, cells);
  const W = box.c1 - box.c0 + 1, H = box.r1 - box.r0 + 1;
  const free = regionFree(st, cells, box);
  const pinnedW = free[1].length === 0 && free[3].length === 0;
  const pinnedH = free[0].length === 0 && free[2].length === 0;

  if (pinnedW && pinnedH) {
    // 定形：这块**最终恰好是它的外接框**——框扩不出去（四侧被封），而长方形又必须含住框。
    // 所以记号要数**框里**的，不能只数连通块里的：框内还可能压着一个尚未并进来的记号
    // （这条被真值审计抓到过一次）。
    const inBox = markersInBox(st, box);
    const shape = `(${box.r0},${box.c0})-(${box.r1},${box.c1}) 定形为 ${W}×${H}`;
    if (inBox.length !== 1) {
      st.contradictions.push({
        rule: 'R4 定形封闭',
        detail: inBox.length
          ? `${shape}，框里却有 ${inBox.length} 个记号（每块恰好一个）`
          : `${shape}，框里一个记号都没有（每块必须有一个）`,
      });
    } else {
      const t = st.markers[inBox[0]].type;
      if (!aspectOk(W, H, t)) {
        st.contradictions.push({
          rule: 'R4 定形封闭',
          detail: `${shape}，记号 \`${MARKER_CHAR[t]}\` 要求宽${t === T_WIDE ? '>' : t === T_TALL ? '<' : '='}高，不满足`,
        });
      } else {
        n += sealBox(st, box, 'R4 定形封闭');
      }
    }
    return n;
  }
  // 还没定形的区域：没有记号就没有尺寸可推（形状尚未定，谈不上下界）
  if (markerOf[g].cnt === 0) return 0;
  const t = st.markers[markerOf[g].mi].type;
  const tag = `\`${ch(st, markerOf[g].mi)}\``;

  // 定宽 W ⇒ 对高度给出硬约束；定高 H 对称。
  const block = (dirs, why) => dirs.reduce((acc, d) => {
    for (const i of free[d]) acc += claim(st, i, d, WALL, 'R3 区域尺寸推理', why);
    return acc;
  }, 0);

  if (pinnedW) {
    if (t === T_SQUARE) {
      if (H > W) st.contradictions.push({ rule: 'R3 区域尺寸推理', detail: `${tag} 宽已定死为 ${W}，高却已有 ${H}` });
      else if (H === W) n += block([0, 2], `${tag} 宽定死为 ${W}，高必须恰好是 ${W}，不能再长`);
      else n += forceGrow(st, free, [0, 2], 'R3 区域尺寸推理', `${tag} 宽定死为 ${W}，高还差 ${W - H}`);
    } else if (t === T_WIDE) {
      if (H > W - 1) st.contradictions.push({ rule: 'R3 区域尺寸推理', detail: `${tag} 宽定死为 ${W}，高 ${H} 已不可能宽>高` });
      else if (H === W - 1) n += block([0, 2], `${tag} 宽定死为 ${W}，高最多 ${W - 1}，已到上限不能再长高`);
    } else {
      if (H < W + 1) n += forceGrow(st, free, [0, 2], 'R3 区域尺寸推理', `${tag} 宽定死为 ${W}，高至少要 ${W + 1}，现只有 ${H}`);
    }
  }
  if (pinnedH) {
    if (t === T_SQUARE) {
      if (W > H) st.contradictions.push({ rule: 'R3 区域尺寸推理', detail: `${tag} 高已定死为 ${H}，宽却已有 ${W}` });
      else if (W === H) n += block([1, 3], `${tag} 高定死为 ${H}，宽必须恰好是 ${H}，不能再长`);
      else n += forceGrow(st, free, [1, 3], 'R3 区域尺寸推理', `${tag} 高定死为 ${H}，宽还差 ${H - W}`);
    } else if (t === T_TALL) {
      if (W > H - 1) st.contradictions.push({ rule: 'R3 区域尺寸推理', detail: `${tag} 高定死为 ${H}，宽 ${W} 已不可能高>宽` });
      else if (W === H - 1) n += block([1, 3], `${tag} 高定死为 ${H}，宽最多 ${H - 1}，已到上限不能再加长`);
    } else {
      if (W < H + 1) n += forceGrow(st, free, [1, 3], 'R3 区域尺寸推理', `${tag} 高定死为 ${H}，宽至少要 ${H + 1}，现只有 ${W}`);
    }
  }
  return n;
}

// ---------------------------------------------------------------- R5 记号可达
/** 只走"还没被墙挡住"的边，i 能否走到某个记号格。 */
function reachesMarker(st, i) {
  const seen = new Uint8Array(st.N);
  const q = [i];
  seen[i] = 1;
  for (let p = 0; p < q.length; p++) {
    const c = q[p];
    if (st.markerAt[c] >= 0) return true;
    for (let d = 0; d < 4; d++) {
      const j = nb(st, c, d);
      if (j < 0 || seen[j] || get(st, c, d) === WALL) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return false;
}

function r5(st) {
  let n = 0;
  for (let i = 0; i < st.N; i++) {
    if (st.markerAt[i] >= 0) continue;
    for (let d = 0; d < 4; d++) {
      if (get(st, i, d) !== UNKNOWN) continue;
      // 把这条边临时当墙：走不到任何记号 ⇒ 它只能打通
      const s = slot(st, i, d);
      s.arr[s.k] = WALL;
      const ok = reachesMarker(st, i);
      s.arr[s.k] = UNKNOWN;
      if (!ok) n += claim(st, i, d, SAME, 'R5 记号可达', `${cellName(st, i)} 封掉${DIR_NAME[d]}侧就到不了任何记号，而每格所属的块必须含一个记号`);
    }
  }
  return n;
}

// ---------------------------------------------------------------- R6 候选形状收敛
/** 每个候选矩形给它的格子 +1（二维差分 + 前缀和），读出"被多少个候选包含"。 */
export function containment(w, h, rects) {
  const W = w + 1;
  const im = new Int32Array((h + 1) * W);
  const at = (r, c) => r * W + c;
  for (const [r0, c0, r1, c1] of rects) {
    im[at(r0, c0)]++;
    im[at(r1 + 1, c0)]--;
    im[at(r0, c1 + 1)]--;
    im[at(r1 + 1, c1 + 1)]++;
  }
  const cnt = new Int32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    im[at(r, c)] += (r ? im[at(r - 1, c)] : 0) + (c ? im[at(r, c - 1)] : 0) -
      (r && c ? im[at(r - 1, c - 1)] : 0);
    cnt[r * w + c] = im[at(r, c)];
  }
  return cnt;
}

/** 竖墙/横墙的前缀和：任一矩形内部的墙段数 O(1) 读出来。 */
export function wallPrefix(st) {
  const { w, h } = st;
  // V[r][c] = 1 若 (r,c-1)|(r,c) 之间是墙（c∈[1,w)）；H[r][c] = 1 若 (r-1,c)|(r,c)（r∈[1,h)）
  const V = new Int32Array((h + 1) * (w + 1));
  const H = new Int32Array((h + 1) * (w + 1));
  for (let r = 0; r < h; r++) for (let c = 1; c < w; c++) V[r * (w + 1) + c] = st.right[r * w + c - 1] === WALL ? 1 : 0;
  for (let r = 1; r < h; r++) for (let c = 0; c < w; c++) H[r * (w + 1) + c] = st.down[(r - 1) * w + c] === WALL ? 1 : 0;
  const build = (A) => {
    const P = new Int32Array((h + 2) * (w + 2));
    const S = (r, c) => P[r * (w + 2) + c];
    for (let r = 0; r <= h; r++) for (let c = 0; c <= w; c++) {
      const v = r < h && c < w ? A[r * (w + 1) + c] : 0;
      P[r * (w + 2) + c] = v + (r ? S(r - 1, c) : 0) + (c ? S(r, c - 1) : 0) - (r && c ? S(r - 1, c - 1) : 0);
    }
    return P;
  };
  const Pv = build(V), Ph = build(H);
  // P[r][c] 是 A 在 [0..r]×[0..c] 上的**闭**前缀和，所以区间查询端点都取闭区间。
  const Q = (P, r0, c0, r1, c1) => {
    if (r1 < r0 || c1 < c0) return 0;
    const W = w + 2;
    const g = (r, c) => (r < 0 || c < 0 ? 0 : P[r * W + c]);
    return g(r1, c1) - g(r0 - 1, c1) - g(r1, c0 - 1) + g(r0 - 1, c0 - 1);
  };
  /** 矩形 [r0..r1]×[c0..c1] 内部（不含外边界）的墙段总数 */
  return (r0, c0, r1, c1) =>
    Q(Pv, r0, c0 + 1, r1, c1) + Q(Ph, r0 + 1, c0, r1, c1);
}

/** 盘上**全部**记号的前缀计数：候选矩形里必须恰好 1 个（它自己的那个）。 */
function markerCountIn(st) {
  const { w, h } = st;
  const A = new Int32Array((h + 1) * (w + 1));
  for (const m of st.markers) A[m.r * (w + 1) + m.c] = 1;
  const W = w + 1;
  const P = new Int32Array((h + 1) * W);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    P[r * W + c] = A[r * W + c] + (r ? P[(r - 1) * W + c] : 0) + (c ? P[r * W + c - 1] : 0) -
      (r && c ? P[(r - 1) * W + c - 1] : 0);
  }
  const g = (r, c) => (r < 0 || c < 0 ? 0 : P[r * W + c]);
  return (r0, c0, r1, c1) => g(r1, c1) - g(r0 - 1, c1) - g(r1, c0 - 1) + g(r0 - 1, c0 - 1);
}

function r6(st) {
  let n = 0;
  const { w, h } = st;
  const countWalls = wallPrefix(st);
  const countMarkers = markerCountIn(st);
  for (let mi = 0; mi < st.markers.length; mi++) {
    const m = st.markers[mi];
    const cands = [];
    for (let r0 = 0; r0 <= m.r; r0++) for (let r1 = m.r; r1 < h; r1++)
      for (let c0 = 0; c0 <= m.c; c0++) for (let c1 = m.c; c1 < w; c1++) {
        const ww = c1 - c0 + 1, hh = r1 - r0 + 1;
        if (!aspectOk(ww, hh, m.type)) continue;
        if (countMarkers(r0, c0, r1, c1) !== 1) continue;     // 恰好吞这一个记号，别人的不行
        if (countWalls(r0, c0, r1, c1) > 0) continue;         // 内部不得有已知墙
        cands.push([r0, c0, r1, c1]);
      }
    if (!cands.length) {
      st.contradictions.push({
        rule: 'R6 候选形状收敛',
        detail: `\`${MARKER_CHAR[m.type]}\` (${m.r},${m.c}) 已经长不出任何合法矩形：候选为空`,
      });
      continue;
    }
    // 只剩一个候选时下面这段照样成立：框内计数=1=候选数，框外=0。
    const cnt = containment(w, h, cands);
    // 每条边只看一次（i 的右、下），所以两种方向都得留在判断里：
    // 早先那句 `if (cnt[i] === 0) continue;` 会让"i 在候选外、j 全含"的左/上边界
    // 永远不进判断，等于凭空少掉一半的外墙。手摆例（3×3 中心 `+`）实测抓到了它。
    for (let i = 0; i < st.N; i++) {
      for (const d of [1, 2]) {
        const j = nb(st, i, d);
        if (j < 0 || get(st, i, d) !== UNKNOWN) continue;
        if (cnt[i] === cands.length && cnt[j] === cands.length) {
          n += claim(st, i, d, SAME, 'R6 候选形状收敛',
            `\`${MARKER_CHAR[m.type]}\` (${m.r},${m.c}) 的 ${cands.length} 种可能形状都同时包含 ${cellName(st, i)} 和 ${cellName(st, j)}`);
        } else if ((cnt[i] === cands.length && cnt[j] === 0) || (cnt[j] === cands.length && cnt[i] === 0)) {
          n += claim(st, i, d, WALL, 'R6 候选形状收敛',
            `\`${MARKER_CHAR[m.type]}\` (${m.r},${m.c}) 无论长成哪种形状，${cellName(st, i)} 与 ${cellName(st, j)} 都不会同属一块`);
        }
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- R7 孤岛记号数
/** 不跨墙可达的极大格集。 */
function islandsOf(st) {
  const seen = new Int32Array(st.N).fill(-1);
  const out = [];
  for (let i = 0; i < st.N; i++) {
    if (seen[i] >= 0) continue;
    const id = out.length, cells = [i];
    seen[i] = id;
    for (let p = 0; p < cells.length; p++) {
      for (let d = 0; d < 4; d++) {
        const j = nb(st, cells[p], d);
        if (j < 0 || seen[j] >= 0 || get(st, cells[p], d) === WALL) continue;
        seen[j] = id;
        cells.push(j);
      }
    }
    out.push(cells);
  }
  return out;
}

function r7(st) {
  let n = 0;
  for (const cells of islandsOf(st)) {
    const here = cells.filter((i) => st.markerAt[i] >= 0);
    if (here.length === 0) {
      st.contradictions.push({
        rule: 'R7 孤岛记号数',
        detail: `${cellName(st, cells[0])} 所在的一片已经被墙围死，里面一个记号都没有（每块必须有一个）`,
      });
      continue;
    }
    if (here.length > 1) continue;
    for (const i of cells) {
      for (let d = 0; d < 4; d++) {
        if (get(st, i, d) !== UNKNOWN) continue;
        n += claim(st, i, d, SAME, 'R7 孤岛记号数',
          `这片孤立区域里只有 \`${ch(st, st.markerAt[here[0]])}\` (${(here[0] / st.w) | 0},${here[0] % st.w}) 一个记号，岛上的格子只能归它`);
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- 驱动
/**
 * 一条规则推到它自己不动为止，每次重算区域划分。
 *
 * 这不是优化，是正确性要求：规则会**打通**边，从而改变"哪些格已经是一块"。
 * 如果一轮里只算一次区域、之后接着用，就会出现"边是新的、区域是旧的"——
 * R3 会拿半个过期划分去做尺寸算术。这个 bug 在 4×4 上真被测出过一条假墙，
 * 而它只可能由真值审计抓到，自洽检查完全看不出来。
 */
function fixpoint(st, rule) {
  for (;;) {
    const before = st.facts.length;
    rule(st, components(st));
    if (st.facts.length === before) return;   // 边数有限，必停
  }
}

/** 规则表。命名规则是这条通道的对外承诺，所以测试台要能**只跑一条**。 */
export const RULES = { R1: r1, R2: r2, R3: r3, R5: r5, R6: r6, R7: r7 };

/** 只跑一条规则到它自己不动为止；返回它这一步新增的断言。R4 是 R3 的分支，共用名单里的 R3。 */
export function runRule(st, name) {
  const f = RULES[name];
  if (!f) throw new Error(`没有名为 ${name} 的规则`);
  fixpoint(st, f);
  return st.facts;
}

/** 一轮全部规则；返回本轮新增的断言数。R4（定形封闭）是 R3 的分支，共用同一次遍历。 */
export function step(st) {
  const before = st.facts.length;
  for (const rule of [r1, r2, r3, r5, r6, r7]) fixpoint(st, rule);
  return st.facts.length - before;
}

/** 边是否全部定完 + 定完的东西是不是一个合法分块。合法性只用 rules.js 判。 */
export function verdict(st) {
  const { comp, groups, markerOf } = components(st);
  const edgesUndecided =
    st.right.some((v, i) => v === UNKNOWN && i % st.w !== st.w - 1) ||
    st.down.some((v, i) => v === UNKNOWN && i + st.w < st.N);
  // 方向约束也要在这里查：前面几条规则都是"顺路"守它，推完的盘却必须整盘复核。
  // 少了这一步，"一格不剩、每块一个记号"的盘里会漏进 3×3 挂 `-` 这种非法解。
  const aspect = groups.every((cells, g) => {
    if (markerOf[g].cnt !== 1) return false;
    const b = regionBox(st, cells);
    return aspectOk(b.c1 - b.c0 + 1, b.r1 - b.r0 + 1, st.markers[markerOf[g].mi].type);
  });
  return {
    lab: Array.from(comp),
    complete: !edgesUndecided,
    rectangular: isRectangular(Array.from(comp), st.w, st.h),
    windmills: windmillPoints(Array.from(comp), st.w, st.h).length,
    regions: groups.length,
    oneMarkerEach: markerOf.every((m) => m.cnt === 1),
    aspect,
  };
}

/**
 * 推到不动为止。stopAtFirst 是给提示用的：只要下一步。
 * 返回里带上"卡住时还剩多少条未知边"，那是难度分数的原料。
 */
export function solve(w, h, markers, opts = {}) {
  const maxPasses = opts.maxPasses ?? 200;
  const st = createSt(w, h, markers);
  let passes = 0;
  while (passes < maxPasses) {
    const added = step(st);
    passes++;
    if (opts.stopAtFirst && added) break;
    if (!added || st.contradictions.length) break;
  }
  const v = verdict(st);
  const contradictions = [...new Map(
    st.contradictions.map((c) => [`${c.rule}|${c.detail}`, c],
    )).values()];
  return {
    st,
    passes,
    facts: st.facts.slice(),
    deductions: st.facts.length,
    contradictions,
    solved: v.complete && v.rectangular && v.windmills === 0 && v.oneMarkerEach && v.aspect,
    unknownEdges: countUnknown(st),
    ruleUse: st.facts.reduce((m, f) => ((m[f.rule] = (m[f.rule] || 0) + 1), m), {}),
    verdict: v,
  };
}

function countUnknown(st) {
  let n = 0;
  for (let i = 0; i < st.N; i++) {
    if (i % st.w !== st.w - 1 && st.right[i] === UNKNOWN) n++;
    if (i + st.w < st.N && st.down[i] === UNKNOWN) n++;
  }
  return n;
}
