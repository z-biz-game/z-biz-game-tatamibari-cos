// 接线层：DOM、手势、时钟、存档、以及下一轮浏览器验闸台要用的 `window.tatamibari`。
//
// 这一层同样**不判任何东西**，也不产生任何"这一盘合不合法"的知识：
//   · 盘面是什么      → js/engine/generate.js（`TIERS` / `generate` / `proveUnique`）
//   · 一笔落下变成什么 → js/ui/game.js（它自己也只是 `pencil.putEdge` 的调用者）
//   · 赢没赢          → js/engine/validate.js::invalidReason，由 Game.checkWin() 去问，本文件只读它的结果
//   · 提示说什么      → js/engine/pencil.js::solve 在空盘上跑出的那条序列，同样经 Game.hint()
//   · 画在哪儿、点中哪条边 → js/render/board.js（命中测试与绘制共用同一套数字）
// 所以这里出现的每一个数字都只能是"读来的"，不是"算出来的"。

import { TIERS, UNSHIPPABLE } from './engine/generate.js';
import { UNKNOWN as P_UNKNOWN } from './engine/pencil.js';
import { layoutFor, BoardView } from './render/board.js';
import { SAVE_KEY, Store } from './store.js';
import {
  cellName, edgeName, Game, makePuzzle, SAME, TOOL_NAME, valName, WALL,
} from './ui/game.js';

const VERSION = '0.1.0';
const $ = (s) => document.querySelector(s);
const DIR_WORD = ['上', '右', '下', '左'];

const el = {
  tierList: $('#tier-list'),
  tierPick: $('#tier-pick'),
  seedInput: $('#seed-input'),
  btnSeed: $('#btn-seed'),
  btnDaily: $('#btn-daily'),
  menuStatus: $('#menu-status'),
  bestList: $('#best-list'),
  totalsLine: $('#totals-line'),
  unshippable: $('#unshippable-note'),
  resumeCard: $('#resume-card'),
  resumeSummary: $('#resume-summary'),
  btnResume: $('#btn-resume'),
  btnDiscard: $('#btn-discard'),
  viewMenu: $('#view-menu'),
  viewGame: $('#view-game'),
  canvas: $('#board'),
  frame: $('#board-frame'),
  preview: $('#board-preview'),
  busy: $('#busy'),
  busyText: $('#busy-text'),
  veil: $('#win-veil'),
  status: $('#status-line'),
  pillState: $('#pill-state'),
  hintLeft: $('#hint-left'),
  clock: $('#hud-clock'),
  tier: $('#hud-tier'),
  size: $('#hud-size'),
  seed: $('#hud-seed'),
  score: $('#hud-score'),
  blocks: $('#hud-blocks'),
  unknown: $('#hud-unknown'),
  walls: $('#hud-walls'),
  merged: $('#hud-merged'),
  moves: $('#hud-moves'),
  hints: $('#hud-hints'),
  clash: $('#hud-clash'),
  winHints: $('#win-hints'),
  winMoves: $('#win-moves'),
  winTime: $('#win-time'),
  winProof: $('#win-proof-line'),
  winRecord: $('#win-record-line'),
  winNote: $('#win-note'),
  toolBtns: { [WALL]: $('#tool-wall'), [SAME]: $('#tool-same'), [P_UNKNOWN]: $('#tool-erase') },
};

const store = Store.load();
const view = { name: 'menu', generating: false };

let game = null;
let board = null;
let startedAt = 0;
let baseMs = 0;
let drag = null;
let pulse = null;
let pulseTimer = 0;
let pendingResume = null;

// ---------------------------------------------------------------- 小工具

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};

const clock = () => (startedAt ? baseMs + (Date.now() - startedAt) : baseMs);

// ── 暂停 ────────────────────────────────────────────────────────────────
// 暂停是**真冻结时钟**，不是挂个标签：暂停那一瞬把还在跑的那一段折进 baseMs，
// 再把 startedAt 清零 —— clock() 于是恒等于 baseMs，一毫秒都不再涨。
// 恢复时重新盖上 startedAt，时钟从冻结处续走；因为 baseMs 已经是累计值，
// 恢复后第一帧的 dt 就是一个正常帧间隔，不会把暂停那几秒一次性吃掉（不跳步）。
let paused = false;
function setPaused(next) {
  next = !!next;
  if (paused === next) return paused;
  if (next) {
    baseMs = clock();     // 先结算到此刻，再停表
    startedAt = 0;
    // 拖到一半按下暂停：这一笔整笔作废。留着 drag，pointermove 还在攒边、抬手就落子，
    // 锁盘就漏了这道缝——而漏进去的那一手恰好发生在"表已经停了"的窗口里。
    if (drag) { drag = null; hidePreview(); paint(); }
  } else {
    startedAt = Date.now();
  }
  paused = next;
  paintPause();
  return paused;
}
function paintPause() {
  const btn = document.getElementById('btn-pause');
  if (!btn) return;
  btn.textContent = paused ? '继续' : '暂停';
  btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
}

// 暂停期间盘面不接受操作。榜按 ms 排名（js/store.js:140 `return a.ms < b.ms;`），只停表不锁盘
// 等于把暂停做成免费的思考时间：想完整盘再按继续，交上去的用时里少掉那几秒——榜还在，榜的含义
// 已经被改写。放行的只有解暂停那颗键、「换一局」（新局一定在走）和「回选档」。
function blockedWhilePaused(what) {
  if (!paused || !game) return false;
  setLine(`${what}被暂停挡住了：按 P 或 空格 继续，暂停中盘面不接受操作。`, 'bad');
  return true;
}

/** 日课 key：本地日期的 ISO 形。"今天"就是玩家所在的那个今天，所以不套 UTC。 */
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const randomSeed = (tierKey) =>
  `${tierKey}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

const tierOf = (key) => TIERS.find((t) => t.key === key) || null;
const sizeOf = (t) => `${t.size[0]}×${t.size[1]}`;

function setMenuLine(text) {
  el.menuStatus.textContent = text || '';
}

function setLine(text, kind = '') {
  el.status.textContent = text || '';
  el.status.className = kind;
}

function show(name) {
  view.name = name;
  el.viewMenu.hidden = name !== 'menu';
  el.viewGame.hidden = name !== 'game';
  if (name === 'menu') renderMenu();
}

// ---------------------------------------------------------------- 选档页

function renderMenu() {
  if (!el.tierList.childElementCount) {
    for (const t of TIERS) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tier-btn';
      const name = document.createElement('span');
      name.className = 'tier-name';
      name.textContent = t.name;
      const size = document.createElement('span');
      size.className = 'tier-size';
      size.textContent = sizeOf(t);
      const desc = document.createElement('span');
      desc.className = 'tier-desc';
      desc.textContent = `实测难度分 ${t.band[0]}–${t.band[1]} · 至少 ${t.struct.minRegions} 块 · 出货上限 ${t.tries} 抽`;
      btn.append(name, size, desc);
      btn.addEventListener('click', () => begin(t.key));
      li.append(btn);
      el.tierList.append(li);
    }
    for (const t of TIERS) {
      const o = document.createElement('option');
      o.value = t.key;
      o.textContent = `${t.name} ${sizeOf(t)}`;
      el.tierPick.append(o);
    }
    // 默认档 = TIERS[1]（第二档）。这一句必须落在"第一次建 option"这一块**里面**：
    // `<select>` 在第一条 option 追加进去的那一刻就把 value 填成了那一条（实测 value='newbie'），
    // 所以旧写法 `if (!el.tierPick.value) el.tierPick.value = TIERS[1].key` 是一个永远不成立的守卫
    // ——默认档静默地没落上，「同档再来一局/日课」都跟着落到第一档。
    el.tierPick.value = (TIERS[1] || TIERS[0]).key;
    el.unshippable.textContent =
      `当前不出货的尺寸：${UNSHIPPABLE.map((u) => `${u.size[0]}×${u.size[1]}`).join(' / ')} —— ` +
      '把判据加满（铅笔推得完 ∧ 预算内证唯一 ∧ 过结构下限）之后抽不出盘。' +
      '抽数与理由写在 js/engine/generate.js::UNSHIPPABLE，并由 npm run balance 每轮重新量一遍。';
  }

  el.bestList.textContent = '';
  for (const t of TIERS) {
    const b = store.bestFor(t.key);
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${t.name} ${sizeOf(t)}：`;
    li.append(label);
    if (b) {
      const rec = document.createElement('span');
      const n1 = document.createElement('b');
      n1.textContent = String(b.hints);
      const n2 = document.createElement('b');
      n2.textContent = String(b.moves);
      const n3 = document.createElement('b');
      n3.textContent = fmtTime(b.ms);
      rec.append('提示 ', n1, ' 次 · 步数 ', n2, ' · 用时 ', n3, ` · seed ${b.seed}`);
      li.append(rec);
    } else {
      const none = document.createElement('span');
      none.className = 'none';
      none.textContent = '还没有纪录';
      li.append(none);
    }
    el.bestList.append(li);
  }
  const tot = store.totals;
  el.totalsLine.textContent =
    `累计：开局 ${tot.played} 盘 · 完成 ${tot.won} 盘 · 用过提示 ${tot.hints} 次`;

  const r = store.resume;
  el.resumeCard.hidden = !r;
  if (r) {
    const t = tierOf(r.tierKey);
    el.resumeSummary.textContent =
      `${t ? t.name : r.tierKey} ${r.w}×${r.h} · seed ${r.seed}${r.daily ? ' · 日课' : ''}` +
      ` · 已画 ${r.moves} 步、用过 ${r.hints} 次提示、走了 ${fmtTime(r.elapsedMs)}`;
  }
}

function renderTools() {
  for (const [value, btn] of Object.entries(el.toolBtns)) {
    const on = !!game && Number(game.mode) === Number(value);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

// ---------------------------------------------------------------- 出题与上台

/**
 * 出题是同步的，而且按档位贵得很快（本轮量到：4×4 约 20 ms、6×6 约 0.2–0.8 s 墙钟；机器忙的时候更贵）。
 * 所以先把"正在出题"画出来、把这一帧交还给浏览器，再在 rAF 回调里跑生成器——
 * 否则页面看起来就是冻住了。
 */
function begin(tierKey, { seed = null, daily = false, resume = null } = {}) {
  const t = tierOf(tierKey);
  // 要灌的存档跟着这一次请求走，不能躺在一个全局里：上一句 `resumeSaved()` 刚写好的东西
  // 会被这一句抹掉（第一版就是这么漏的——续玩卡浮出来了、ink 却没回去）。
  pendingResume = resume;
  if (!t) {
    show('menu');
    setMenuLine(`没有叫 ${tierKey} 的档——档名只有 ${TIERS.map((x) => x.key).join(' / ')}。`);
    return;
  }
  const origin = seed || (daily ? `daily:${dateKey()}:${t.key}` : randomSeed(t.key));
  view.generating = true;
  show('game');
  el.veil.hidden = true;
  el.busy.hidden = false;
  el.busyText.textContent = `正在抽第 ${t.name} ${sizeOf(t)} 的一盘——每盘都要现跑一遍铅笔推演与穷举唯一性证明。`;
  el.canvas.classList.add('busy');
  setLine('正在出题……');
  requestAnimationFrame(() => {
    const { puzzle, tries, seedUsed, reason } = makePuzzle(origin, t.key);
    view.generating = false;
    el.busy.hidden = true;
    el.canvas.classList.remove('busy');
    if (!puzzle) {
      setMenuLine(`${reason}（这一档抽了 ${tries} 次都没出货，换一档试试。）`);
      show('menu');
      return;
    }
    const g = new Game(puzzle);
    g.__seedUsed = seedUsed || puzzle.seed;
    g.__daily = daily;
    if (pendingResume && pendingResume.seed === g.__seedUsed && pendingResume.tierKey === puzzle.tierKey) {
      const r = pendingResume;
      pendingResume = null;
      adopt(g, { resumeFrom: r });
    } else {
      adopt(g, { daily, seedUsed: g.__seedUsed });
    }
  });
}

/** 存档要灌进的就是刚抽出来的这张盘：seed 与档名都对上才灌。 */
function resumeSaved() {
  const r = store.resume;
  if (!r) return;
  begin(r.tierKey, { seed: r.seed, resume: r });
}

/**
 * 一个 Game 上台。`integrity` 不为 null 就说明这盘不该面世：引擎没能从空盘把它推完，
 * 或者那条序列没有覆盖每一条内部边——那"提示"就有一步没有出处。宁可报错，不许硬上。
 */
function adopt(next, { daily = false, seedUsed = null, resumeFrom = null } = {}) {
  if (next.integrity) {
    setMenuLine(next.integrity);
    pendingResume = null;
    show('menu');
    return null;
  }
  game = next;
  game.daily = resumeFrom ? !!resumeFrom.daily : daily;
  game.seedUsed = resumeFrom ? resumeFrom.seed : (seedUsed || next.puzzle.seed);
  baseMs = resumeFrom ? resumeFrom.elapsedMs || 0 : 0;
  startedAt = Date.now();
  // 换一局＝新的一局，新局一定在走：带着上一局的 paused=true 进来会让时钟和按钮各说各话
  if (paused) { paused = false; paintPause(); }
  if (resumeFrom && !game.load(resumeFrom.ink)) {
    store.clearResume();
    game = null;
    pendingResume = null;
    setMenuLine('存档里的那条边数组读不通（长度或值不合规），已经丢掉它，改开新的一盘。');
    show('menu');
    return null;
  }
  if (resumeFrom) {
    game.moves = resumeFrom.moves || 0;
    game.hints = resumeFrom.hints || 0;
    game.prunes = resumeFrom.prunes || 0;
  } else {
    store.submitStart();
  }
  if (!board) board = new BoardView(el.canvas);
  el.veil.hidden = true;
  show('game');
  layout();
  syncAll();
  setLine(resumeFrom ? '存档已恢复：提示与步数都照原样计，撤销不会退还它们。' : describe());
  if (resumeFrom) flushResume();
  return game;
}

// ---------------------------------------------------------------- 画与同步

function layout() {
  if (!game || !board) return;
  // **量**容器，不猜视口。上一版写的是 `window.innerWidth <= 640 ? innerWidth - 34 : frame.clientWidth - 16`
  // 与 `innerHeight - 300`：
  //   · 前者在"视口很宽、但 `#shell` 的 max-width 把容器压小"时算出比容器还宽的可用宽（940 的盘放进 300 的
  //     容器时它给的是 906），画布于是被 CSS 等比压进容器，而 `hitEdge` 用的是没压的那套 `geo.cell`
  //     ——画上去的线与点下去的边分家，board.js:39 那句"不许把格子缩"当场失效；
  //   · 后者那个 300 是抄来的：顶栏/标题/状态行/HUD 十一枚药丸各占多高，改一处它就漂（实测本盘在
  //     1280×1024 下容器上沿就在 161px，300 既不是这个数也不是"盘下面那些控件"的数）。
  // 现在两条都是实测：宽 = frame 的内容盒（border-box 减去自己的 border+padding）；
  // 高 = 视口下沿 − frame 内容上沿 − frame 自己的下边（盘整体落在第一屏里，下面的图例该滚就让页面滚）。
  // 容器小到给不出 `Cell.min`（44px）时，`layoutFor` 仍然按 44 画、画布溢出，由 #board-frame 自己滚
  // —— 那是渲染层写死的口径，不是这里的兜底。
  const rect = el.frame.getBoundingClientRect();
  const cs = getComputedStyle(el.frame);
  const availW = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
  const contentTop = rect.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const availH = window.innerHeight - contentTop
    - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
  board.resize(game, Math.max(280, availW), Math.max(240, availH));
  paint();
}

function paint() {
  if (!game || !board) return;
  board.draw(game, { pulse, preview: drag ? { segs: drag.segs } : null });
}

function syncHud() {
  const s = game.state();
  el.tier.textContent = `${s.name}${game.daily ? ' · 日课' : ''}`;
  el.size.textContent = `${s.w}×${s.h}`;
  el.seed.textContent = game.seedUsed;
  el.score.textContent = `${s.score}（档带 ${s.band ? `${s.band[0]}–${s.band[1]}` : '—'}）`;
  el.blocks.textContent = `${s.regions}/${s.markers}`;
  el.unknown.textContent = s.unknown;
  el.walls.textContent = s.walls;
  el.merged.textContent = s.merged;
  el.moves.textContent = s.moves;
  el.hints.textContent = s.hints;
  el.clash.textContent = s.clashes;
  el.clock.textContent = fmtTime(clock());
  el.hintLeft.textContent = `剩 ${Math.max(0, s.script - s.cursor)}`;
  el.pillState.textContent = s.status === 'won'
    ? '已铺开'
    : `已定 ${s.decided}/${s.edges}${s.illegal ? ' · 尚未合法' : ''}`;
  el.pillState.classList.toggle('win', s.status === 'won');
  el.pillState.classList.toggle('bad', s.clashes > 0);
  renderTools();
}

function syncAll() {
  syncHud();
  paint();
}

/** 状态行：引擎说出来的那一句，这里只负责拼成中文，不改判据。 */
function describe() {
  const s = game.state();
  if (s.status === 'won') {
    return '每块都是长方形、每块恰好一个记号、也没有四块共角——js/engine/validate.js::invalidReason 说这一盘合法。';
  }
  if (s.clashes) {
    const c = game.contradictions[0];
    return `你画下的线被铅笔通道当场证伪（${c.rule}：${c.detail}）——先撤销那一笔，提示不会替你圆场。`;
  }
  if (!s.done) {
    return `还有 ${s.unknown} 条边没定（已定 ${s.decided}/${s.edges}）；现在连着 ${s.regions} 块，而记号有 ${s.markers} 个。`;
  }
  return `每条边都定完了，但引擎说：${s.illegal}。`;
}

function setPulse(i, dir, ms = 1600) {
  pulse = { i, dir };
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    pulse = null;
    paint();
  }, ms);
}

function afterStep() {
  syncAll();
  flushResume();
  const s = game.state();
  setLine(describe(), s.clashes ? 'bad' : s.status === 'won' ? 'good' : '');
  if (s.status === 'won') onWin();
}

// ---------------------------------------------------------------- 结算

function onWin() {
  const ms = clock();
  const s = game.state();
  const { isBest, prev } = store.submitWin(s.tierKey, {
    hints: s.hints,
    moves: s.moves,
    ms,
    seed: game.seedUsed,
  });
  store.clearResume();
  el.winHints.textContent = s.hints;
  el.winMoves.textContent = s.moves;
  el.winTime.textContent = fmtTime(ms);
  el.winProof.textContent =
    `解的唯一性在浏览器里又数了一遍：${s.sols} 个解、${s.nodes} 个节点、${s.proofMs.toFixed(2)} ms` +
    '（countAnchored 的 limitSolutions:2 那一路）· 出题时实测难度分 ' +
    `${s.score} · 铅笔序列 ${s.script} 条、${s.passes} 轮推完`;
  el.winRecord.textContent = isBest
    ? '本档新纪录。'
    : `本档旧纪录：提示 ${prev.hints} 次 · 步数 ${prev.moves} · 用时 ${fmtTime(prev.ms)}——这次没超过它。`;
  el.winNote.textContent = s.agree === true
    ? '两条通道（空盘上那条铅笔序列 / 穷举计数器交出的那份分块）在这盘上逐条边一致。'
    : '注意：两条通道的一致性没对上——这是引擎的 bug，请把这一盘的 seed 报出去。';
  el.veil.hidden = false;
  syncHud();
  // 状态行必须跟遮罩说同一句话：`solveWithLogic()` 那一路不经过 afterStep，
  // 少了这一句的话赢家看到的是开局时那句"还有 24 条边没定"。
  setLine(describe(), 'good');
}

// ---------------------------------------------------------------- 操作

function setMode(value) {
  if (!game || blockedWhilePaused('切工具')) return;
  game.mode = value;
  renderTools();
  paint();
}

function useHint() {
  if (!game || game.status === 'won' || blockedWhilePaused('那一次提示')) return null;
  const h = game.hint();
  if (!h) return null;
  if (h.conflict) {
    setPulse(h.i, h.dir);
    syncAll();
    setLine(h.conflict, 'bad');
    return h;
  }
  if (h.stalled) {
    syncHud();
    setLine(h.text);
    return h;
  }
  setPulse(h.i, h.dir);
  afterStep();
  // 这一下把盘铺完了的话，afterStep/onWin 已经写了"这一盘合法"那一句，别拿提示的句子盖掉它
  // （上一版就是这儿盖的：遮罩说铺满了、状态行还留着"还有 24 条边没定"那种开局的话）。
  if (game.status !== 'won') setLine(`${h.rule}｜${edgeName(game.w, h.i, h.dir)} 必须是「${valName(h.value)}」——${h.why}`, 'good');
  return h;
}

function undo() {
  if (!game || blockedWhilePaused('撤销')) return null;
  // 赢了就把这盘冻住：`Game.undo()` 自己没有 status 守卫（它只管退栈），所以放任它的话，
  // 玩家能在遮罩还挂着的时候把最后一条边擦回未定 —— 于是 `#win-veil` 说"铺满了"而
  // `state().status` 已经变回 'playing'，再走一次 afterStep 还会把同一盘往 totals 里记第二遍。
  // 落笔/提示/补墙在引擎那一层就拒了（game.js 的 `status === 'won'` 三处），撤销是唯一的漏口。
  if (game.status === 'won') {
    setLine('这一盘已经铺完了——要再来一盘请按「同档再来一局」。');
    return null;
  }
  const step = game.undo();
  if (!step) {
    setLine('没有可撤销的一笔了。');
    return null;
  }
  afterStep();
  setLine(`撤销了 ${step.writes.length} 条边（${step.kind === 'hint' ? '那是一条提示' : '一次落笔'}）。提示次数不退还。`);
  return step;
}

function prune() {
  if (!game || blockedWhilePaused('补那一眼墙')) return null;
  const step = game.prune();
  if (!step) {
    setLine('这一眼墙已经补过了——空盘上那条 R1 特例没有新的可写。');
    return null;
  }
  afterStep();
  setLine(`补了 ${step.writes.length} 条墙：${game.freeReason}`);
  return step;
}

function flushResume() {
  if (!game || view.name !== 'game' || game.status === 'won') return false;
  return store.saveResume({
    seed: game.seedUsed,
    tierKey: game.puzzle.tierKey,
    w: game.w,
    h: game.h,
    ink: game.ink(),
    moves: game.moves,
    hints: game.hints,
    prunes: game.prunes,
    elapsedMs: clock(),
    daily: !!game.daily,
  });
}

// ---------------------------------------------------------------- 手势

/** 手指落在一条边上会写成什么：与 Game.tappedValue 同式（自己的记号就是擦）。 */
function segValue(hit) {
  const cur = game.valueAt(hit.i, hit.dir);
  return cur === game.mode ? P_UNKNOWN : game.mode;
}

function pushSeg(hit) {
  const slot = game.slotOf(hit.i, hit.dir);
  if (!slot) return;
  const key = `${slot.arr}${slot.k}`;
  if (drag.keys.has(key)) return;
  drag.keys.add(key);
  drag.segs.push(hit);
}

el.canvas.addEventListener('pointerdown', (ev) => {
  if (!game || game.status === 'won' || view.generating) return;
  if (blockedWhilePaused('点那条边')) return;
  const hit = board.hitEdge(ev.clientX, ev.clientY);
  if (!hit) return;
  ev.preventDefault();
  try {
    el.canvas.setPointerCapture(ev.pointerId);
  } catch {
    /* 少数指针 id 不支持 capture：拖动降级成单点，也还能玩 */
  }
  drag = { segs: [], keys: new Set(), value: segValue(hit), mode: game.mode };
  pushSeg(hit);
  showPreview(hit, ev);
  paint();
});

el.canvas.addEventListener('pointermove', (ev) => {
  if (!game) return;
  const hit = board.hitEdge(ev.clientX, ev.clientY);
  if (drag) {
    ev.preventDefault();
    if (hit) {
      pushSeg(hit);
      showPreview(hit, ev);
    }
    paint();
    return;
  }
  if (hit) showPreview(hit, ev);
  else hidePreview();
});

function endDrag(ev) {
  if (!drag) return;
  const d = drag;
  drag = null;
  hidePreview();
  if (ev && ev.pointerId != null) {
    try {
      el.canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* 指针抬起时已经自动释放 */
    }
  }
  // 一下没拖动的手势走引擎那一手叫 `tap` 的路径（`Game.tap()`：点自己的记号就是擦），
  // 不是"只扫到一条边的 stroke"。 kinds 分开是有下游的：撤销那句怎么说、`steps[].kind` 写什么、
  // 存档重放与 node 侧那一遍都要对得上（clash 场景断言「撤的是那一笔」= tap，node 夹具的
  // saveOps 里 `t:` 用的也是 `g.tap()`）。旧写法一律走 `stroke()`，于是 'tap' 这一 kind
  // 在真指针下永远到不了，只有绕过命中测试的 `window.tatamibari.tap()` 才产生得出它。
  const only = d.segs.length === 1 ? d.segs[0] : null;
  const step = only
    ? game.tap(only.i, only.dir, d.mode)
    : game.stroke(d.segs, d.value);
  if (step) afterStep();
  else paint();
  return step;
}

el.canvas.addEventListener('pointerup', endDrag);
el.canvas.addEventListener('pointercancel', endDrag);
el.canvas.addEventListener('pointerleave', () => {
  if (!drag) hidePreview();
});
el.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

function showPreview(hit, ev) {
  const rect = el.frame.getBoundingClientRect();
  const next = drag ? drag.value : segValue(hit);
  el.preview.textContent = `${cellName(game.w, hit.i)} ${DIR_WORD[hit.dir]}侧 → ${valName(next)}`;
  el.preview.hidden = false;
  el.preview.style.left = `${Math.max(4, Math.min(rect.width - 170, ev.clientX - rect.left + 12))}px`;
  el.preview.style.top = `${Math.max(4, ev.clientY - rect.top - 26)}px`;
}

function hidePreview() {
  el.preview.hidden = true;
}

// ---------------------------------------------------------------- 按钮与键盘

el.btnSeed.addEventListener('click', () => {
  begin(el.tierPick.value || TIERS[0].key, { seed: el.seedInput.value.trim() || null });
});

el.btnDaily.addEventListener('click', () => {
  begin(el.tierPick.value || TIERS[0].key, { daily: true });
});

el.btnResume.addEventListener('click', resumeSaved);
el.btnDiscard.addEventListener('click', () => {
  store.clearResume();
  show('menu');
  setMenuLine('存档已丢弃。');
});

const again = () => game && begin(game.puzzle.tierKey, { daily: false });
$('#btn-again').addEventListener('click', again);
$('#btn-new').addEventListener('click', again);
$('#btn-menu').addEventListener('click', () => {
  flushResume();
  show('menu');
});
$('#btn-menu-2').addEventListener('click', () => show('menu'));
$('#btn-hint').addEventListener('click', useHint);
$('#btn-prune').addEventListener('click', prune);
$('#btn-undo').addEventListener('click', undo);
$('#btn-reset').addEventListener('click', () => {
  store.reset();
  game = null;
  pendingResume = null;
  show('menu');
  setMenuLine('本地存档已清空。');
});

for (const [value, btn] of Object.entries(el.toolBtns)) {
  btn.addEventListener('click', () => setMode(Number(value)));
}

function cycleMode() {
  if (!game) return;
  setMode(game.mode === WALL ? SAME : game.mode === SAME ? P_UNKNOWN : WALL);
}

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  if (k === 'escape' && view.name === 'game') {
    flushResume();
    show('menu');
    return;
  }
  // 暂停锁盘挂在这一层，而不是只包 stroke/tap：1/2/3/m 改工具态、h/g/z 直接动盘，它们各走各的
  // 函数，逐个包会漏掉下一个新加的键。放行的只有解暂停那颗键、「换一局」（新局一定在走，见
  // adopt()），以及上面已经 return 掉的 Escape（回选档不改这盘的盘面）。
  if (paused && !(k === 'p' || k === ' ' || k === 'n')) { blockedWhilePaused('那一键'); ev.preventDefault(); return; }
  if (k === '1') setMode(WALL);
  else if (k === '2') setMode(SAME);
  else if (k === '3') setMode(P_UNKNOWN);
  else if (k === 'm') cycleMode();
  else if (k === 'h') useHint();
  else if (k === 'g') prune();
  else if (k === 'z') undo();
  else if (k === 'p' || k === 'P' || k === ' ' || ev.code === 'Space') {
    ev.preventDefault();
    setPaused(!paused);
  }
  else if (k === 'n' && game && view.name === 'game') again();
  else return;
  ev.preventDefault();
});

window.addEventListener('resize', () => layout());
window.addEventListener('pagehide', flushResume);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushResume();
});

setInterval(() => {
  if (!game || view.name !== 'game' || game.status === 'won') return;
  el.clock.textContent = fmtTime(clock());
}, 1000);

// 系统主题翻面时重读一遍调色板：渲染层的颜色只有 css/game.css 一份来源。
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const refetch = () => {
    if (!board) return;
    board.refreshPalette();
    paint();
  };
  if (mq.addEventListener) mq.addEventListener('change', refetch);
  else if (mq.addListener) mq.addListener(refetch);
}

renderMenu();
show('menu');

// ---------------------------------------------------------------- 验闸台用的那一面

window.tatamibari = {
  version: VERSION,
  view: () => view.name,
  get game() {
    return game;
  },
  get puzzle() {
    return game ? game.puzzle : null;
  },
  show,
  begin,
  adopt,
  useHint,
  undo,
  prune,
  setMode,
  flushResume,
  resumeSaved,
  daily: (tierKey) => begin(tierKey || (TIERS[1] || TIERS[0]).key, { daily: true }),
  /** 手势的编程等价物：走的正是指针抬起时那一句 game.stroke()。 */
  stroke(segs, value) {
    if (!game || blockedWhilePaused('那一笔')) return null;
    const step = game.stroke(segs, value === undefined ? game.mode : value);
    if (step) afterStep();
    return step;
  },
  tap(i, dir, value) {
    if (!game || blockedWhilePaused('那一下')) return null;
    const step = game.tap(i, dir, value === undefined ? game.mode : value);
    if (step) afterStep();
    return step;
  },
  /** 把那条序列一路走完（每一下都经 hint()，所以次数照扣）——"零猜测"那一条断言用它。 */
  solveWithLogic() {
    if (!game || blockedWhilePaused('整盘推导')) return null;
    const r = game.solveWithLogic();
    syncAll();
    if (game.status === 'won') onWin();
    return r;
  },
  revealAll() {
    if (!game || game.status === 'won' || blockedWhilePaused('摊开整盘')) return null;
    const step = game.revealAll();
    if (step) afterStep();
    return step;
  },
  elapsed: clock,
  get paused() {
    return paused;
  },
  setPaused,
  /** 正在推进的那个数（毫秒）。暂停时它必须一毫秒不动 —— 这就是"真冻结"的判据。 */
  simClock: () => clock(),
  dateKey,
  state: () => (game ? { ...game.state(), elapsedMs: clock(), view: view.name, daily: !!game.daily } : null),
  hitAt: (x, y) => (board ? board.hitEdge(x, y) : null),
  cellCenter(i) {
    if (!board) return null;
    const p = board.cellXY(i);
    const rect = el.canvas.getBoundingClientRect();
    return { x: rect.left + p.x + p.size / 2, y: rect.top + p.y + p.size / 2 };
  },
  geometry: () => (game && board
    ? { geo: board.geo, canvas: el.canvas.getBoundingClientRect(), layout: layoutFor(game.w, game.h, 800, 600) }
    : null),
  toolName: (v) => TOOL_NAME[v],
  dom: { ...el, toolBtns: undefined },
  store,
  engine: { TIERS, UNSHIPPABLE, makePuzzle, Game, Store, SAVE_KEY },
};

// ---- 暂停按钮（#btn-pause，与 P / Space 同一个入口）----
(function bindPause() {
  const btn = document.getElementById('btn-pause');
  if (!btn) return;   // HUD 里没有这个 id 就不装，别让量具算出"已实现"的假绿
  btn.addEventListener('click', () => setPaused(!paused));
})();

// ---- 全屏开关（#btn-fullscreen）----
// 绑的是本页 HUD 上真实存在的那个按钮。全屏最常见的假实现就是引用一个并不存在的
// id：点下去什么也不会发生，量具却算它"已实现"。所以这里找不到按钮就直接不装。
(function bindFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;
  const root = document.documentElement;
  // 只做特性检测，不嗅探 UA：iOS Safari 是 webkitRequestFullscreen，老 Edge 是 ms 前缀，
  // 而 UA 字符串随时会改。"有没有这个能力"是查出来的，不是猜出来的。
  const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  const current = () => document.fullscreenElement || document.webkitFullscreenElement
    || document.msFullscreenElement || null;

  // 不支持也要给个说法：只把按钮灰掉而不解释，玩家会以为这功能没做完。
  // supported 这枚标记不能省：下面 sync() 每次都会重写 title，不挡住的话，装的时候刚写
  // 进去的人话原因会被随后的 sync() 立刻抹成"全屏 (F)"——禁用就变成一句没有理由的禁用。
  let supported = !!req;
  const unsupported = () => {
    supported = false;
    btn.disabled = true;
    btn.title = '这个浏览器不提供元素全屏（iOS Safari 请用「添加到主屏幕」独立打开）';
  };
  if (!req) unsupported();

  // fullscreen 返回 Promise，被拒时必须吃掉：iOS Safari 对多数非 video 元素直接拒绝，
  // 让这个 rejection 冒泡出去会变成一条未捕获错误，整局游戏跟着挂。
  // 但拒绝要分两种，别把一次"没给许可"当成"这台机器不行"：NotAllowedError 说的是**这一次**
  // 请求的授权（没有瞬时用户激活、iframe 的 allow 里缺 fullscreen），过一会儿再点就好；
  // 上一版一律走 unsupported()，于是自动化/受限上下文里一次被拒就把一颗好按钮永久禁掉，
  // 还对玩家谎称"这个浏览器不提供元素全屏"。真正没有这能力的是 req 本身不存在（上面已判）。
  const settle = (p) => {
    if (p && p.catch) p.catch((err) => { if (!err || err.name !== 'NotAllowedError') unsupported(); });
  };

  // 进出都能走：已经全屏时这次调用是退出，不是"再进一次"。
  function toggle() {
    try {
      if (current()) {
        if (exit) settle(exit.call(document));
      } else if (req) {
        settle(req.call(root));
      } else {
        unsupported();
      }
    } catch (e) {
      unsupported();
    }
  }

  // Esc 和系统手势退出都不经过我们的代码，按钮状态只能靠 fullscreenchange 回写，
  // 否则用户已经退出、HUD 还停在"退出全屏"，下一次点击反而会重新进全屏。
  function sync() {
    const on = !!current();
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? "退出全屏" : "全屏";
    if (supported) btn.title = "全屏" + '（F）';
    const body = document.body;
    if (body && body.classList) body.classList.toggle('fullscreen', on);
  }

  btn.addEventListener('click', toggle);
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'f' && ev.key !== 'F') return;
    const t = ev.target;
    // 盘号 / 种子这类输入框里打字不能触发全屏，否则玩家输 seed 输到一半屏幕没了。
    if (t && /input|textarea|select/i.test(t.tagName || '')) return;
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    toggle();
  });
  window.addEventListener('fullscreenchange', sync);
  window.addEventListener('webkitfullscreenchange', sync);
  window.addEventListener('MSFullscreenChange', sync);
  sync();
})();
