// 玩家循环的状态机：一条边怎么落下、一笔怎么撤销、什么时候算赢、提示准说什么。
//
// 这一层**不判任何东西**。仓里"什么算合法盘"只有一份定义，就在
// `js/engine/validate.js::invalidReason`（它自己只用 `rules.js` 的长方形/风车判据与
// `counter.js::aspectOk` 的方向判据）；本文件要判胜负就问它一句，绝不把这几条规则在 UI 里
// 再抄一遍。同样地，边怎么存、块怎么连、下一步能证什么，也都由引擎给：
//   · 盘面状态 = `pencil.createSt()` 交出的那两条边数组（`right` / `down`，三态
//     未知 / 墙 / 同块），玩家的每一笔只通过 `pencil.putEdge()` 落进去；
//   · 块 = `pencil.components()`（沿"同块"边连通），外接框 = `rules.regionBoxes()`；
//   · 判合法 = `rules.isRectangular()` + `validate.invalidReason()`；
//   · 提示 = `pencil.solve()` 在**空盘**上跑出的那条推导序列（出题器验收这一盘用的就是同一个
//     函数、同一组记号），不是从玩家画下的线里现推的；
//   · 唯一性 = `generate.proveUnique()`，即穷举计数器 `limitSolutions: 2` 那一遍，浏览器里
//     再复核一次，读出来的节点数与毫秒数直接进面板。
//
// 提示为什么必须来自"空盘那一条路径"：pencil.js 的头文件第 3 条承诺每一步都在**所有**合法
// 分块上成立，出货前 `tools/pencil-test.mjs` 还拿真值分块逐条审计过。所以那条序列里的每一条
// 都是唯一解上的一句真话，提示念它就不会把玩家往错的地方带；而它又确实是"下一步能证什么"，
// 因为序列按推出顺序排——轮到第几条，就说明前几条已经是盘面上的事实。
//
// 一次手势 = 一条快照。撤销因此是逐格还原而不是"重推一遍"，提示用掉也不退还（记录按求助次数
// 排序，退还就能靠撤销刷出一个干净的"提示 0"）。

import { MARKER_CHAR } from '../engine/counter.js';
import { createSt, components, putEdge, runRule, SAME, solve, step, UNKNOWN, WALL } from '../engine/pencil.js';
import { generate, proveUnique, TIERS } from '../engine/generate.js';
import { isRectangular, regionBoxes } from '../engine/rules.js';
import { invalidReason } from '../engine/validate.js';

export { SAME, UNKNOWN, WALL };

/** 三种工具：工具的取值就是它要写进那条边的值，所以"点自己的记号就是擦"这一条对三种工具同式。 */
export const TOOLS = [WALL, SAME, UNKNOWN];
export const TOOL_NAME = { [WALL]: '画墙', [SAME]: '打通', [UNKNOWN]: '擦掉' };

const DIR_NAME = ['上', '右', '下', '左'];
const VAL_NAME = { [UNKNOWN]: '未定', [WALL]: '墙', [SAME]: '同块' };
/** 铅笔通道的轮数上限，跟 `pencil.solve()` 的 maxPasses 默认值同一条，不另立口径。 */
const MAX_PASSES = 200;

/**
 * 一条内部边的规范地址：它落在引擎那两条数组里的哪一格。
 * 这里只有下标算术，没有任何判定——`pencil.js` 里同式的 `slot()` 是私有的，本文件既不读规则
 * 也不写规则，只是把 (格, 方向) 折成一个槽位；读出来的值与 `putEdge()` 写进去的值落在同一格。
 * 返回 null 表示盘外：盘外就是边界墙（与 `pencil.js` 里 `get()` 同口径）。
 */
export function edgeSlot(st, i, dir) {
  const { w, h } = st;
  const c = i % w;
  const r = (i / w) | 0;
  if (dir === 0) return r > 0 ? { arr: 'down', k: i - w } : null;
  if (dir === 2) return r < h - 1 ? { arr: 'down', k: i } : null;
  if (dir === 1) return c < w - 1 ? { arr: 'right', k: i } : null;
  return c > 0 ? { arr: 'right', k: i - 1 } : null;
}

export function readEdge(st, i, dir) {
  const s = edgeSlot(st, i, dir);
  return s ? st[s.arr][s.k] : WALL;
}

/** 全盘内部边，每条只出现一次（每格只看它的右侧与下侧）。 */
export function internalEdges(w, h) {
  const out = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      if (c < w - 1) out.push({ i, dir: 1 });
      if (r < h - 1) out.push({ i, dir: 2 });
    }
  }
  return out;
}

/** 同一条边的字符串身份（给 Set / Map 用），与 `edgeSlot` 是一式两写。 */
const keyOf = (st, i, dir) => {
  const s = edgeSlot(st, i, dir);
  return s ? `${s.arr}${s.k}` : null;
};

export const cellName = (w, i) => `(${(i / w) | 0},${i % w})`;
export const edgeName = (w, i, dir) => `${cellName(w, i)} 的${DIR_NAME[dir]}侧`;
export const valName = (v) => VAL_NAME[v] || '未知';
export const markerChar = (type) => MARKER_CHAR[type];

// ---------------------------------------------------------------- 出题

/**
 * 抽一盘：`generate()` 抽不到货（tries 上限内没抽到"铅笔推得完 ∧ 计数器证唯一 ∧ 过结构下限"）
 * 会**响亮地返回 null**，所以这里换派生 seed 重试，一条判据都不放松。
 * 派生方式是 `seed|1`、`seed|2`…——与生成器自己的 `again|3` 同一种写法，所以"同 seed 两跑同盘"
 * 那条性质（balance 第六段守的）不会被这一层破坏。
 */
export function makePuzzle(originSeed, tierKey, { retries = 6 } = {}) {
  if (!TIERS.some((t) => t.key === tierKey)) return { puzzle: null, tries: 0, reason: `没有叫 ${tierKey} 的档` };
  for (let k = 0; k <= retries; k++) {
    const seed = k === 0 ? originSeed : `${originSeed}|${k}`;
    const p = generate(seed, tierKey);
    if (p) return { puzzle: p, tries: k + 1, seedUsed: seed, reason: null };
  }
  return { puzzle: null, tries: retries + 1, reason: `${tierKey} 档连抽 ${retries + 1} 次都没出货` };
}

// ---------------------------------------------------------------- 局面

export class Game {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.w = puzzle.w;
    this.h = puzzle.h;
    this.N = this.w * this.h;
    this.markers = puzzle.markers.map((m) => ({ r: m.r, c: m.c, type: m.type }));
    this.st = createSt(this.w, this.h, this.markers);
    this.edges = internalEdges(this.w, this.h);
    this.steps = [];
    this.moves = 0;
    this.hints = 0;
    this.prunes = 0;
    this.status = 'playing';
    this.mode = WALL;
    this.cursor = 0;
    this.lastHint = null;
    this.loadScript();
    this.verifyClues();
    this.recompute();
  }

  // ------------------------------------------------------------ 提示那条通道
  /**
   * 一次性把"空盘推到完"的那条序列读进来。
   * 两条硬性质不满足就不让这盘面世：① `solved`（引擎从空盘推得完——"零猜测"那句话的实际含义）；
   * ② 序列**覆盖每一条内部边**（`claim()` 只往未定的边上写，所以推得完的盘必然每条边出现一次）。
   * 少一条就说明"提示"会有一步没有出处，那宁可报生成错误。
   */
  loadScript() {
    const run = solve(this.w, this.h, this.markers);
    this.script = run.facts;
    this.scriptSolved = run.solved;
    this.scriptPasses = run.passes;
    this.scriptRuleUse = run.ruleUse;
    const seen = new Set();
    for (const f of this.script) {
      const k = keyOf(this.st, f.i, f.dir);
      if (k) seen.add(k);
    }
    this.scriptCovers = seen.size === this.edges.length;
    this.integrity = this.scriptSolved && this.scriptCovers
      ? null
      : `引擎没能从空盘把这一盘推到底（solved=${this.scriptSolved}、覆盖 ${seen.size}/${this.edges.length} 条边）—— 本盘不出`;
    // 空盘上 R1 只能命中"相邻两格都是记号"那一条特例（此时每个区域就是一格），
    // 所以这一批墙是人眼看完的、一条推理都不欠的——"补一眼墙"按钮的全部来源。
    const fresh = createSt(this.w, this.h, this.markers);
    this.freeWalls = runRule(fresh, 'R1').filter((f) => f.want === WALL);
    this.freeReason = this.freeWalls.length ? this.freeWalls[0].reason : '';
  }

  /** 计数器那一条独立通道在浏览器里再走一遍：恰好一个解、多少节点、多少毫秒。 */
  verifyClues() {
    const p = proveUnique(this.w, this.h, this.markers);
    this.uniqueness = { sols: p.sols, nodes: p.nodes, ms: p.ms, proved: p.proved, overBudget: p.overBudget };
    this.answer = p.blocks;
    // 两条通道给的答案必须逐边一致：穷举器交出的分块折成边的三态，与铅笔序列应当一格不差。
    // 这不是 UI 的判据，只是把 balance 里"两条通道给出同一份合法分块"那一条在看盘时再读一次。
    this.channelsAgree = this.agreesWithAnswer();
  }

  agreesWithAnswer() {
    if (!this.answer || !this.scriptCovers) return null;
    const owner = new Int32Array(this.N).fill(-1);
    this.answer.forEach((b, id) => {
      for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) owner[r * this.w + c] = id;
    });
    if (owner.some((v) => v < 0)) return false;
    const want = new Map();
    for (const e of this.edges) {
      const j = this.neighbour(e.i, e.dir);
      want.set(keyOf(this.st, e.i, e.dir), owner[e.i] === owner[j] ? SAME : WALL);
    }
    if (want.size !== this.script.length) return false;
    for (const f of this.script) {
      const k = keyOf(this.st, f.i, f.dir);
      if (!k || want.get(k) !== f.want) return false;
    }
    return true;
  }

  neighbour(i, dir) {
    return dir === 0 ? i - this.w : dir === 2 ? i + this.w : dir === 1 ? i + 1 : i - 1;
  }

  // ------------------------------------------------------------ 判
  /** 玩家画下的线：块怎么连、还差几条边、有没有被自己的线当场证伪。 */
  recompute() {
    const G = components(this.st);
    this.groups = G.groups;
    this.markerOf = G.markerOf;
    this.lab = G.comp;
    this.rects = [...regionBoxes(this.lab, this.w, this.h).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, b]) => b);
    // 判合法：整盘谓词只此一份，来自 js/engine/validate.js。
    this.illegal = invalidReason(this.w, this.h, this.markers, this.rects);
    // `invalidReason` 是从**外接框**重建 labeling 的，"块不是长方形"那一支它只能以「框叠了 ⇒
    // 有格没铺满」的形式撞上。每块格数等于它外接框面积，当且仅当它本来就是长方形——那一句由
    // `rules.isRectangular()` 说：它就是 validate.js 内部用的同一个函数，这里只是拿它去量
    // 玩家自己的 labeling 而不是框的 labeling，仍然没有第二套判定。
    this.rectOk = isRectangular(this.lab, this.w, this.h);
    this.unknown = this.edges.reduce((n, e) => n + (readEdge(this.st, e.i, e.dir) === UNKNOWN ? 1 : 0), 0);
    this.walls = this.edges.reduce((n, e) => n + (readEdge(this.st, e.i, e.dir) === WALL ? 1 : 0), 0);
    this.merged = this.edges.length - this.unknown - this.walls;
    // "已经画不下去"只报玩家自己的线**当场证得出来**的那些：把 ink 原样搬到一份新状态上，交给
    // 铅笔通道往前推，它报矛盾才算。推不出来就不算错——这条通道本来就是故意比计数器弱的。
    const probe = this.probe();
    this.contradictions = probe.contradictions;
    this.derivable = probe.facts.length;
    return this;
  }

  /** 玩家 ink 的一份副本，让铅笔通道在它上面往前推。推出来的矛盾是真的，本文件一条都不发明。 */
  probe() {
    const st = createSt(this.w, this.h, this.markers);
    for (const e of this.edges) putEdge(st, e.i, e.dir, readEdge(this.st, e.i, e.dir));
    for (let p = 0; p < MAX_PASSES; p++) {
      const added = step(st);
      if (!added || st.contradictions.length) break;
    }
    return st;
  }

  complete() {
    return this.unknown === 0;
  }

  /** 赢 = 边全定完 ∧ 每块确实是长方形 ∧ invalidReason 说这一盘合法。三句都是引擎的话。 */
  checkWin() {
    this.status = this.complete() && this.rectOk && this.illegal === null ? 'won' : 'playing';
    return this.status === 'won';
  }

  // ------------------------------------------------------------ 写
  slotOf(i, dir) {
    return edgeSlot(this.st, i, dir);
  }

  valueAt(i, dir) {
    return readEdge(this.st, i, dir);
  }

  /** 一条边"点一下"会写成什么：自己的记号就擦，否则盖上工具的值。手指与渲染共用这一句。 */
  tappedValue(i, dir, mode = this.mode) {
    const k = this.slotOf(i, dir);
    if (!k) return null;
    const cur = this.st[k.arr][k.k];
    if (mode === UNKNOWN) return cur === UNKNOWN ? null : UNKNOWN;
    return cur === mode ? UNKNOWN : mode;
  }

  write(i, dir, value) {
    const k = this.slotOf(i, dir);
    if (!k) return null;
    const from = this.st[k.arr][k.k];
    if (from === value) return null;
    putEdge(this.st, i, dir, value);
    return { i, dir, key: `${k.arr}${k.k}`, from, to: value };
  }

  commit(kind, writes, extra = {}) {
    if (!writes.length) return null;
    const step = { kind, writes, ...extra };
    this.steps.push(step);
    if (kind === 'hint') this.hints++;
    else if (kind === 'prune') this.prunes++;
    else if (kind !== 'reveal') this.moves++;
    this.recompute();
    this.checkWin();
    return step;
  }

  tap(i, dir, mode = this.mode) {
    if (this.status === 'won' || !TOOLS.includes(mode)) return null;
    const want = this.tappedValue(i, dir, mode);
    if (want === null) return null;
    const w = this.write(i, dir, want);
    return w ? this.commit('tap', [w], { value: want }) : null;
  }

  /** 一次拖 = 一笔：手势扫过的边全部写同一个值，不逐格翻转，所以撤销也是一整条线退回去。 */
  stroke(segs, value) {
    if (this.status === 'won' || !TOOLS.includes(value)) return null;
    const seen = new Set();
    const writes = [];
    for (const s of segs || []) {
      // 按**规范槽位**去重，不是按 (格,方向)：从左边格的右侧进来和从右边格的左侧进来是同一条边。
      const k = keyOf(this.st, s.i, s.dir);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const w = this.write(s.i, s.dir, value);
      if (w) writes.push(w);
    }
    return writes.length ? this.commit('stroke', writes, { value }) : null;
  }

  /** 免费那一手：只写空盘上 R1 那一条特例给出的墙，一条"打通"都不替你画。 */
  prune() {
    if (this.status === 'won') return null;
    const writes = [];
    for (const f of this.freeWalls) {
      const w = this.write(f.i, f.dir, WALL);
      if (w) writes.push(w);
    }
    return writes.length ? this.commit('prune', writes, { value: WALL }) : null;
  }

  undo() {
    const step = this.steps.pop();
    if (!step) return null;
    for (const w of step.writes) putEdge(this.st, w.i, w.dir, w.from);
    // 撤一条提示（或整盘 reveal）时，边还原了，**script 游标也必须退回去**：`hint()` 只会从
    // cursor 往后走，游标不退回就被撤的那一条就永远再也提不到——玩家撤掉一次求助之后这盘
    // 在"提示"这条路下再也铺不完（实测：撤 8/1 那一条之后 cursor=24、unknown=1、status=playing）。
    // "零猜测"那句说的是提示这条路必须能推到底，所以这是产品缺陷，不是断言写歪。
    // 次数照旧不退还（上面那条注释：退还就能靠撤销刷出一个干净的"提示 0"）。
    if (step.kind === 'hint' || step.kind === 'reveal') {
      let at = this.script.length;
      for (const w of step.writes) {
        const k = this.script.findIndex((f) => f.i === w.i && f.dir === w.dir);
        if (k >= 0 && k < at) at = k;
      }
      if (at < this.cursor) this.cursor = at;
    }
    if (step.kind === 'prune') this.prunes = Math.max(0, this.prunes - 1);

    else if (step.kind !== 'hint' && step.kind !== 'reveal') this.moves = Math.max(0, this.moves - 1);
    this.recompute();
    this.checkWin();
    return step;
  }

  // ------------------------------------------------------------ 提示
  /** 现在说不通的地方（玩家自己的线被引擎当场证伪）。null = 没有。 */
  clash() {
    if (!this.contradictions.length) return null;
    const c = this.contradictions[0];
    const last = this.steps[this.steps.length - 1];
    const w = last && last.writes && last.writes.length ? last.writes[last.writes.length - 1] : null;
    return { i: w ? w.i : -1, dir: w ? w.dir : -1, why: `${c.rule}：${c.detail}` };
  }

  /**
   * 下一条**可证**的事实：顺着空盘那条序列往下走，跳过玩家已经画对的边。
   * 撞上玩家画反的边就只说话不下笔、而且不扣次数——这一枝就是"提示不许当答案按钮"的守门。
   */
  hint() {
    if (this.status === 'won') return null;
    const clash = this.clash();
    if (clash) {
      return { conflict: `${clash.why} —— 先撤销那一笔。提示没有扣次数。`, i: clash.i, dir: clash.dir, charged: false };
    }
    while (this.cursor < this.script.length) {
      const f = this.script[this.cursor];
      const k = this.slotOf(f.i, f.dir);
      if (!k) {
        this.cursor++;
        continue;
      }
      const cur = this.st[k.arr][k.k];
      if (cur === f.want) {
        this.cursor++;
        continue;
      }
      if (cur !== UNKNOWN) {
        return {
          conflict: `${edgeName(this.w, f.i, f.dir)} 与线索矛盾：${f.rule} 说那里必须是「${valName(f.want)}」。提示没有扣次数。`,
          i: f.i,
          dir: f.dir,
          charged: false,
        };
      }
      const w = this.write(f.i, f.dir, f.want);
      this.cursor++;
      if (!w) continue;
      this.commit('hint', [w], { value: f.want, rule: f.rule });
      const info = {
        rule: f.rule,
        i: f.i,
        dir: f.dir,
        value: f.want,
        why: f.reason,
        charged: true,
        left: this.script.length - this.cursor,
      };
      this.lastHint = info;
      return info;
    }
    return { stalled: true, text: '铅笔序列已经走完，剩下的边只能自己收尾。' };
  }

  /** 只给验闸台与"看整条路"用：把序列走完。每一下都走 hint()，所以次数照扣。 */
  solveWithLogic({ cap = 4000 } = {}) {
    let k = 0;
    while (this.status !== 'won' && k++ < cap) {
      const before = this.steps.length;
      const h = this.hint();
      if (!h || h.stalled || h.conflict) break;
      if (this.steps.length === before) break;
    }
    return { status: this.status, steps: k, hints: this.hints };
  }

  /** 把整条序列一次落进盘面（验闸台拿它当"另一条路也走到同一张盘"的证据，不计步数）。 */
  revealAll() {
    const writes = [];
    for (const f of this.script) {
      const w = this.write(f.i, f.dir, f.want);
      if (w) writes.push(w);
    }
    this.cursor = this.script.length;
    return writes.length ? this.commit('reveal', writes, { value: null }) : null;
  }

  // ------------------------------------------------------------ 存档
  /** 存档只存边（0/1/2 两条数组）。盘面是 seed 的函数，不需要穿过 localStorage。 */
  ink() {
    const right = new Uint8Array(this.N);
    const down = new Uint8Array(this.N);
    for (const e of this.edges) {
      const k = this.slotOf(e.i, e.dir);
      const v = this.st[k.arr][k.k];
      if (k.arr === 'right') right[k.k] = v;
      else down[k.k] = v;
    }
    return { right: Array.from(right), down: Array.from(down) };
  }

  /** 读档：长度不对、类型不对、值不在 0/1/2 里，一律不信（返回 false，调用方丢掉这条存档）。 */
  load(ink) {
    const put = (arr, list) => {
      if (!Array.isArray(list) || list.length !== this.N) return false;
      for (let i = 0; i < this.N; i++) if (list[i] !== UNKNOWN && list[i] !== WALL && list[i] !== SAME) return false;
      for (let i = 0; i < this.N; i++) this.st[arr][i] = list[i];
      return true;
    };
    const ok = !!ink && put('right', ink.right) && put('down', ink.down);
    this.steps = [];
    this.cursor = 0;
    this.recompute();
    this.checkWin();
    return ok;
  }

  state() {
    const t = TIERS.find((x) => x.key === this.puzzle.tierKey) || {};
    return {
      tier: this.puzzle.tier,
      tierKey: this.puzzle.tierKey,
      name: t.name || this.puzzle.tierKey,
      seed: this.puzzle.seed,
      w: this.w,
      h: this.h,
      markers: this.markers.length,
      moves: this.moves,
      hints: this.hints,
      prunes: this.prunes,
      status: this.status,
      edges: this.edges.length,
      decided: this.edges.length - this.unknown,
      unknown: this.unknown,
      walls: this.walls,
      merged: this.merged,
      regions: this.groups.length,
      done: this.complete(),
      illegal: this.illegal,
      rectOk: this.rectOk,
      clashes: this.contradictions.length,
      derivable: this.derivable,
      score: this.puzzle.score,
      band: t.band || null,
      passes: this.puzzle.passes,
      script: this.script.length,
      cursor: this.cursor,
      steps: this.steps.length,
      mode: this.mode,
      sols: this.uniqueness.sols,
      nodes: this.uniqueness.nodes,
      proofMs: this.uniqueness.ms,
      agree: this.channelsAgree,
      integrity: this.integrity,
    };
  }
}
