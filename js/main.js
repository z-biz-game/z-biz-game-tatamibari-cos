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
import { Sound } from './audio.js';
import { layoutFor, BoardView } from './render/board.js';
import { Fx } from './render/fx.js';
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
  fxLayer: $('#fx-layer'),
  frame: $('#board-frame'),
  preview: $('#board-preview'),
  busy: $('#busy'),
  busyText: $('#busy-text'),
  veil: $('#win-veil'),
  pauseVeil: $('#pause-veil'),
  btnPause: $('#btn-pause'),
  pauseLabel: $('#pause-label'),
  btnResumePlay: $('#btn-resume-play'),
  btnPauseMenu: $('#btn-pause-menu'),
  btnSound: $('#btn-sound'),
  btnFullscreen: $('#btn-fullscreen'),
  btnHelp: $('#btn-help'),
  btnHelpClose: $('#btn-help-close'),
  helpVeil: $('#help-veil'),
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
const fx = new Fx({ motion: !prefersReducedMotion() });
const sound = new Sound({ muted: store.muted, onChange: (m) => store.setMuted(m) });

let game = null;
let board = null;
let runMs = 0;        // 这一盘**跑着**了多少毫秒：暂停期间一个字都不加
let runFrom = 0;      // 当前这段计时的起点时间戳，0 = 没在跑（暂停/未开局）
let paused = false;
let drag = null;
let pendingResume = null;
let lastFrame = 0;    // rAF 的上一帧时间戳（对拍脚本喂的是虚拟时长，不是墙钟）
let rafId = 0;

/** 系统"减少动效"偏好。读不到 matchMedia 就当没这个偏好（宁可动，也别静默关掉反馈）。 */
function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 小工具

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};

/**
 * 这一盘走了多久：`runMs`（已经跑完的那些段）+ 当前这段的墙钟差。
 * 不是一枚 `startedAt` 减出来的：暂停必须把正在跑的这一段**结算**进 runMs 并把 runFrom 归零，
 * 否则恢复之后暂停掉的那几分钟会一起算进用时（也一起进纪录比较与存档）。
 */
const clock = () => runMs + (runFrom ? Date.now() - runFrom : 0);

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
  if (name === 'game') startLoop();
  else stopLoop();
}

// ---------------------------------------------------------------- 动效循环
//
// 这一圈 rAF 是全仓唯一吃"帧 dt"的地方：`step(dt)` 之后所有位移/衰减/寿命都按秒走，
// 所以 30 / 60 / 120 Hz 下同一串虚拟时长落在盘上的量必须一样（对拍见 commit 正文）。
// 暂停 = 根本不调 step()，于是 fx.clock / dashPhase / pulse.t 与这一盘的计时器一起冻住。

function frame(now) {
  rafId = 0;
  if (view.name !== 'game' || paused) return;
  // 首帧 lastFrame 是 0：那一帧的 dt 会是一个几百毫秒的巨值（页面加载到现在），夹住它。
  const dt = lastFrame ? Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)) : 0;
  lastFrame = now;
  const moving = fx.step(dt);
  fx.render();
  if (moving || fx.particles.length || fx.pulse) paint();
  if (fx.active) schedule();
}

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function startLoop() {
  lastFrame = 0;
  // 没有粒子/脉冲也照样留这一圈：这层的存在就是"按秒推进"，而 `frame()` 自己会在
  // 盘静止时省掉那次 paint()。上一版写的是 `if (... && fx.active)`，于是脉冲一旦衰减完
  // 这一圈就自杀了，之后落笔再也点不亮光带。
  if (!paused && view.name === 'game') schedule();
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

// ---------------------------------------------------------------- 暂停与时钟
//
// 计时不是一个 `startedAt`：暂停必须把**正在跑的这一段**结算进 runMs 并把 runFrom 归零，
// 否则恢复之后暂停掉的那几分钟会一起算进用时（然后一起进纪录比较与存档）。
// 暂停同时冻住 fx：`frame()` 在 paused 时直接 return，所以 dashPhase / pulse.t / 粒子寿命
// 与这一盘的时间一起停——对拍脚本喂虚拟时长时也是同一条口径。

/** 把正在跑的这一段结算进 runMs：暂停与胜利都走这一句，之后 clock() 就冻住了。 */
function settleRun() {
  if (runFrom) {
    runMs += Date.now() - runFrom;
    runFrom = 0;
  }
  return runMs;
}

function applyPause(next) {
  const on = !!next;
  if (on && !paused) {
    settleRun();
    stopLoop();
    flushResume();
  }
  if (!on && paused) runFrom = Date.now();
  paused = on;
  el.pauseVeil.hidden = !on;
  el.btnPause.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.pauseLabel.textContent = on ? '继续' : '暂停';
  if (!on) startLoop();
  syncHud();
  return paused;
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
  // 叠加层与 #board **同尺寸同位置**：粒子坐标就是画布坐标，两套数字必须一份来源。
  // dpr 也走画布那一条（board.resize 里是同一个 Math.round），否则高 DPR 屏上墨点会糊。
  if (!fx.layer) fx.attach(el.fxLayer);
  if (el.fxLayer) {
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    fx.resize(board.geo.w, board.geo.h, dpr);
    el.fxLayer.style.left = `${el.canvas.offsetLeft || 0}px`;
    el.fxLayer.style.top = `${el.canvas.offsetTop || 0}px`;
  }
  paint();
}

function paint() {
  if (!game || !board) return;
  board.draw(game, { fx, preview: drag ? { segs: drag.segs } : null });
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

/**
 * 让那一条边亮起来。以前这里是一枚 `setTimeout(1600)`：光带的消失挂在**墙钟**上，
 * 暂停时它照旧消失、对拍脚本喂虚拟时长时它纹丝不动。现在寿命住在 `fx.pulse.t` 里，
 * 由那一圈 rAF 按 dt 推进——暂停就一起冻住，虚拟时长走多少它就活多久。
 */
function setPulse(i, dir, life = 1.6) {
  fx.setPulse(i, dir, { life });
  startLoop();
  paint();
}

// ---------------------------------------------------------------- 落笔的反馈
//
// 两条都不许碰盘面本身：墨点住在 #fx-layer 那张叠加画布上（浏览器闸按精确色取 #board 的
// 像素，任何加法混合都会把"格心 = --surface、光带 = --hint"那几条读数带歪），
// 声音在静音态根本排不出节点（见 js/audio.js 那三条口径）。
// 中点从 `board.segmentRect()` 读——命中测试、绘制、粒子因此共用同一套数字。

function edgeMid(i, dir) {
  if (!board) return null;
  const s = board.segmentRect(i, dir);
  if (!s) return null;
  return {
    axis: s.axis,
    len: s.len,
    x: s.axis === 'v' ? s.x : s.x + s.len / 2,
    y: s.axis === 'v' ? s.y + s.len / 2 : s.y,
  };
}

/** 最近一步最后落下的那条边——墨点的位置从它来，不在这里重新推算。 */
function lastEdge() {
  if (!game || !game.steps.length) return null;
  const w = game.steps[game.steps.length - 1].writes.slice(-1)[0];
  return w ? { i: w.i, dir: w.dir } : null;
}

/** 一声 + 一撮墨。`tone` 只是音色名，判据一条都不在这儿。 */
function feedback(tone, edge = lastEdge()) {
  sound.play(tone);
  const m = edge ? edgeMid(edge.i, edge.dir) : null;
  if (m) {
    fx.burstSegment(m.x, m.y, m.axis, tone === 'merge' ? 7 : 4, {
      hue: tone === 'merge' ? 172 : tone === 'erase' ? 210 : 168,
      len: m.len,
    });
    startLoop();
  }
}

function lastStep() {
  return game && game.steps.length ? game.steps[game.steps.length - 1] : null;
}

function toneOfStep(step) {
  if (!step) return 'ui';
  if (step.kind === 'hint') return 'hint';
  if (step.kind === 'prune') return 'wall';
  if (step.value === SAME) return 'merge';
  if (step.value === P_UNKNOWN) return 'erase';
  return 'wall';
}

function afterStep(tone = null) {
  feedback(tone || toneOfStep(lastStep()));
  syncAll();
  flushResume();
  const s = game.state();
  setLine(describe(), s.clashes ? 'bad' : s.status === 'won' ? 'good' : '');
  if (s.status === 'won') onWin();
}

// ---------------------------------------------------------------- 结算

function onWin() {
  settleRun();
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
  // 号声与墨：静音态 fanfare() 一个节点都不排，关掉动效 burst() 直接给 0 粒——
  // 两条都是"看起来做了"的高发区，所以读数写在 sound.played / fx.state().particles 上。
  sound.fanfare();
  if (board) fx.burst(board.geo.w / 2, board.geo.h / 2, 26, { hue: 168, spread: 260, up: 170 });
  startLoop();
}

// ---------------------------------------------------------------- 操作

/** 暂停与"还没进对局"两种情况都算按不住：闸门只此一处口径，别在每个动作里各写一遍。 */
function blocked() {
  return paused || view.name !== 'game' || view.generating;
}

function setMode(value) {
  if (!game || blockedWhilePaused('切工具')) return;
  game.mode = value;
  renderTools();
  paint();
  sound.play('ui');
}

function useHint() {
  if (!game || game.status === 'won' || blockedWhilePaused('那一次提示')) return null;
  const h = game.hint();
  if (!h) return null;
  if (h.conflict) {
    setPulse(h.i, h.dir);
    feedback('clash', { i: h.i, dir: h.dir });
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
  afterStep('erase');
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

/**
 * 重开本盘：**同一张 puzzle**（seed 与档都不变），只把这一盘的墨、次数、游标、计时与动效清掉。
 * 重新走 `generate()` 的话玩家会以为"重开"给的是另一盘——这里要的正是同一盘再来一遍。
 */
function restartGame() {
  if (!game || blocked()) return null;
  const puzzle = game.puzzle;
  const daily = game.daily;
  const seedUsed = game.seedUsed;
  const fresh = new Game(puzzle);
  game = null;
  adopt(fresh, { daily, seedUsed });
  setLine('这一盘的墨已清空：seed、档位、提示次数与用时都从头再来。');
  return fresh;
}

/** 全屏：拿浏览器给的 promise 回执改按钮态，拿不到（被拒绝/不支持）就照实说。 */
function toggleFullscreen() {
  const root = document.documentElement;
  const on = !!document.fullscreenElement;
  let p = null;
  let supported = true;
  if (!on && root.requestFullscreen) p = root.requestFullscreen();
  else if (on && document.exitFullscreen) p = document.exitFullscreen();
  else supported = false;
  if (p && p.catch) p.catch(() => setLine('浏览器没让这一页进全屏（通常是要更强的用户手势授权）——按钮状态不变。'));
  if (!supported) setLine('这个环境没有 requestFullscreen：全屏按钮在这儿不做任何事，不假装进了全屏。');
  sound.play('ui');
  return !on;
}

function syncFullscreenLabel() {
  const on = !!document.fullscreenElement;
  el.btnFullscreen.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.btnFullscreen.setAttribute('aria-label', on ? '退出全屏' : '全屏');
}

function toggleHelp(on) {
  const next = on === undefined ? el.helpVeil.hidden : !!on;
  el.helpVeil.hidden = !next;
  el.btnHelp.setAttribute('aria-pressed', next ? 'true' : 'false');
  sound.play('ui');
  return next;
}

/** 静音：真挂起 AudioContext（不是把 gain 压 0），状态穿过 store 落到 localStorage。 */
function toggleSound(on) {
  unlockAudio(); // 键盘/点击本身就是手势：第一次按 M 也要能把 context 建起来，别只翻个布尔
  const muted = sound.setMuted(on === undefined ? !sound.muted : !!on);
  syncSoundLabel(muted);
  return muted;
}

function syncSoundLabel(muted) {
  el.btnSound.setAttribute('aria-pressed', muted ? 'true' : 'false');
  el.btnSound.setAttribute('aria-label', muted ? '解除静音' : '静音');
  const img = el.btnSound.querySelector('img');
  if (img) img.src = `assets/ui/sound-${muted ? 'off' : 'on'}.png`;
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
//
// onDown/onMove/onUp 是**唯一**的一条路径：指针事件、touch 回退、鼠标回退都汇到这里，
// 所以"点中哪条边、写成什么值"不会有第二套口径（命中测试本身在 board.hitEdge）。

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
    el.canvas.setPointerCapture(pointerId);
  } catch {
    /* 少数指针 id 不支持 capture：拖动降级成单点，也还能玩 */
  }
  drag = { segs: [], keys: new Set(), value: segValue(hit), mode: game.mode };
  pushSeg(hit);
  showPreview(hit, clientX, clientY);
  paint();
  return true;
}

function onMove(clientX, clientY) {
  if (!game || !board) return;
  const hit = board.hitEdge(clientX, clientY);
  if (drag) {
    if (hit) {
      pushSeg(hit);
      showPreview(hit, clientX, clientY);
    }
    paint();
    return;
  }
  if (hit && !blocked()) showPreview(hit, clientX, clientY);
  else hidePreview();
}

function onUp(pointerId) {
  if (!drag) return null;
  const d = drag;
  drag = null;
  hidePreview();
  if (pointerId != null) {
    try {
      el.canvas.releasePointerCapture(pointerId);
    } catch {
      /* 指针抬起时已经自动释放 */
    }
  }
  if (!game || paused) return null;
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

const hasPointerEvents = () => typeof window.PointerEvent !== 'undefined';

if (hasPointerEvents()) {
  el.canvas.addEventListener('pointerdown', (ev) => {
    if (onDown(ev.clientX, ev.clientY, ev.pointerId)) ev.preventDefault();
  });
  el.canvas.addEventListener('pointermove', (ev) => {
    if (drag) ev.preventDefault();
    onMove(ev.clientX, ev.clientY);
  });
  el.canvas.addEventListener('pointerup', (ev) => onUp(ev.pointerId));
  el.canvas.addEventListener('pointercancel', (ev) => onUp(ev.pointerId));
  el.canvas.addEventListener('pointerleave', () => {
    if (!drag) hidePreview();
  });
} else {
  // 没有 PointerEvent 就等于"这环境根本没有指针事件"，不是"有但没写"：touch 与 mouse
  // 各走一遍上面那条唯一路径，鼠标只认左键。
  el.canvas.addEventListener('touchstart', (ev) => {
    const t = ev.changedTouches && ev.changedTouches[0];
    if (t && onDown(t.clientX, t.clientY, t.identifier)) ev.preventDefault();
  }, { passive: false });
  el.canvas.addEventListener('touchmove', (ev) => {
    const t = ev.touches && ev.touches[0];
    if (t) ev.preventDefault();
    onMove(t ? t.clientX : 0, t ? t.clientY : 0);
  }, { passive: false });
  el.canvas.addEventListener('touchend', (ev) => onUp(ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0].identifier : null));
  el.canvas.addEventListener('touchcancel', () => onUp(null));
  el.canvas.addEventListener('mousedown', (ev) => {
    if (ev.button) return;
    if (onDown(ev.clientX, ev.clientY, -1)) ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => { if (drag) ev.preventDefault(); onMove(ev.clientX, ev.clientY); });
  window.addEventListener('mouseup', () => onUp(-1));
}

el.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

function showPreview(hit, clientX, clientY) {
  if (!game || blocked()) return;
  const rect = el.frame.getBoundingClientRect();
  const next = drag ? drag.value : segValue(hit);
  el.preview.textContent = `${cellName(game.w, hit.i)} ${DIR_WORD[hit.dir]}侧 → ${valName(next)}`;
  el.preview.hidden = false;
  el.preview.style.left = `${Math.max(4, Math.min(rect.width - 170, clientX - rect.left + 12))}px`;
  el.preview.style.top = `${Math.max(4, clientY - rect.top - 26)}px`;
}

function hidePreview() {
  el.preview.hidden = true;
}

// ---------------------------------------------------------------- 按钮与键盘

/**
 * AudioContext 必须在**真实用户手势**里才建得起来（浏览器与 iOS 都是这个口径），
 * 所以这函数只被第一次 pointerdown / keydown / click 调用，之后自己摘掉监听。
 */
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return true;
  audioUnlocked = true;
  sound.unlock();
  syncSoundLabel(sound.muted);
  for (const [target, type] of [[window, 'pointerdown'], [window, 'keydown'], [window, 'click']]) {
    target.removeEventListener(type, unlockAudio);
  }
  return true;
}
for (const [target, type] of [[window, 'pointerdown'], [window, 'keydown'], [window, 'click']]) {
  target.addEventListener(type, unlockAudio, { passive: true });
}

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

el.btnPause.addEventListener('click', () => {
  if (!game || game.status === 'won') return;
  applyPause(!paused);
  sound.play('ui');
});
el.btnResumePlay.addEventListener('click', () => applyPause(false));
el.btnPauseMenu.addEventListener('click', () => {
  applyPause(false);
  flushResume();
  show('menu');
});
el.btnSound.addEventListener('click', () => {
  unlockAudio();
  toggleSound();
});
el.btnFullscreen.addEventListener('click', () => {
  toggleFullscreen();
  syncFullscreenLabel();
});
el.btnHelp.addEventListener('click', () => toggleHelp());
el.btnHelpClose.addEventListener('click', () => toggleHelp(false));

for (const [value, btn] of Object.entries(el.toolBtns)) {
  btn.addEventListener('click', () => setMode(Number(value)));
}

function cycleMode() {
  if (!game || blocked()) return;
  setMode(game.mode === WALL ? SAME : game.mode === SAME ? P_UNKNOWN : WALL);
}

/** 选档页的 Enter/空格：开当前下拉里那一档。对局页的同一枚键是暂停/继续。 */
function startFromMenu() {
  begin(el.tierPick.value || TIERS[0].key, { seed: null });
}

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  const k = ev.key.toLowerCase();
  if (!el.helpVeil.hidden) {
    if (k === 'escape' || k === '?' || k === 'enter' || k === ' ') {
      toggleHelp(false);
      ev.preventDefault();
    }
    return;
  }
  if (k === 'escape') {
    if (paused) applyPause(false);
    else if (view.name === 'game') {
      flushResume();
      show('menu');
    }
    ev.preventDefault();
    return;
  }
  if (k === '?' || (k === '/' && ev.shiftKey)) {
    toggleHelp(true);
    ev.preventDefault();
    return;
  }
  if (k === 'enter' && view.name !== 'game') {
    startFromMenu();
    ev.preventDefault();
    return;
  }
  if (k === ' ') {
    if (view.name === 'game') applyPause(!paused);
    else startFromMenu();
    ev.preventDefault();
    return;
  }
  // 暂停锁盘挂在这一层，而不是只包 stroke/tap：1/2/3/m 改工具态、h/g/z 直接动盘，它们各走各的
  // 函数，逐个包会漏掉下一个新加的键。放行的只有解暂停那颗键、「换一局」（新局一定在走，见
  // adopt()），以及上面已经 return 掉的 Escape（回选档不改这盘的盘面）。
  if (paused && !(k === 'p' || k === ' ' || k === 'n')) { blockedWhilePaused('那一键'); ev.preventDefault(); return; }
  if (k === '1') setMode(WALL);
  else if (k === '2') setMode(SAME);
  else if (k === '3') setMode(P_UNKNOWN);
  // 键位就按页面图例与玩法说明那一份：M 静音、T 轮换工具（派工单 §2 点名 M 是静音）。
  // tools/scenarios.js 里那条 keyd('m') 的断言跟着改成 keyd('t')——它测的是"键盘能轮换工具"
  // 这条行为，不是 'm' 这个字母。
  else if (k === 't') cycleMode();
  else if (k === 'm') toggleSound();
  else if (k === 'f') toggleFullscreen();
  else if (k === 'p') applyPause(view.name === 'game' ? !paused : false);
  else if (k === 'r' && game && view.name === 'game') restartGame();
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
window.addEventListener('fullscreenchange', syncFullscreenLabel);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushResume();
});

setInterval(() => {
  if (!game || view.name !== 'game' || game.status === 'won' || paused) return;
  el.clock.textContent = fmtTime(clock());
}, 1000);

// 系统"减少动效"是真的偏好，会中途改：关掉时清掉在飞的粒子与虚线相位，开回来就从零起步。
if (window.matchMedia) {
  const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    fx.setMotion(!rm.matches);
    paint();
    if (!paused) startLoop();
  };
  if (rm.addEventListener) rm.addEventListener('change', applyMotion);
  else if (rm.addListener) rm.addListener(applyMotion);
}

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

// ---------------------------------------------------------------- 离线缓存那一层
//
// `file://` 下**不注册**：那时脚本的 origin 是 null，规范里 register() 直接拒
// （Chrome 报 "The URL protocol of the script ('file://…/sw.js') is not supported"），
// 而 Electron 的打包预览走的正是 file://。所以这一句必须真的分两条路，而不是套个
// try/catch 让它在控制台炸一声就算"降级"。结果挂在 window.tatamibari.serviceWorker 上，
// 验闸台读得到就行。
function registerServiceWorker() {
  if (typeof location === 'undefined') return 'no-location';
  if (location.protocol === 'file:') return 'skipped-file';
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return 'no-sw-api';
  try {
    const p = navigator.serviceWorker.register('sw.js');
    if (p && p.then) {
      p.then(() => { window.tatamibari.serviceWorker = 'registered'; })
        .catch(() => { window.tatamibari.serviceWorker = 'failed'; });
    }
    return 'pending';
  } catch {
    return 'failed';
  }
}

syncSoundLabel(store.muted);
syncFullscreenLabel();
el.helpVeil.hidden = true;
el.pauseVeil.hidden = true;
const swMode = registerServiceWorker();

/**
 * manifest 的 shortcuts 写着 `?daily=1` 与 `?resume=1`——那两条不能只是"能点开的空壳"：
 * 参数必须真的开局。没有存档的时候 `?resume=1` 就落回选档并照实说一句（不假装续上了）。
 */
function applyDeepLink() {
  let q;
  try {
    q = new URLSearchParams((typeof location !== 'undefined' && location.search) || '');
  } catch {
    return 'no-url';
  }
  if (q.get('resume') === '1') {
    if (store.resume) {
      resumeSaved();
      return 'resume';
    }
    setMenuLine('链接要续玩，但本地没有存档——落在选档页，选一档就能开局。');
    return 'resume-empty';
  }
  if (q.get('daily') === '1') {
    const key = TIERS.some((t) => t.key === q.get('tier')) ? q.get('tier') : (TIERS[1] || TIERS[0]).key;
    begin(key, { daily: true });
    return 'daily';
  }
  return 'none';
}

renderMenu();
show('menu');
const deepLink = applyDeepLink();

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
  get paused() {
    return paused;
  },
  fx,
  sound,
  serviceWorker: swMode,
  deepLink,
  show,
  begin,
  adopt,
  useHint,
  undo,
  prune,
  setMode,
  applyPause,
  restartGame,
  toggleSound,
  toggleHelp,
  toggleFullscreen,
  flushResume,
  resumeSaved,
  daily: (tierKey) => begin(tierKey || (TIERS[1] || TIERS[0]).key, { daily: true }),
  /** 系统"减少动效"那一条真分支：关掉不喷粒子、虚线不前进、光带钉在峰值。 */
  setMotion(on) {
    const m = fx.setMotion(on);
    paint();
    return m;
  },
  /**
   * 帧率对拍用的推进器：**绕开 rAF**，按虚拟时间戳一帧一帧喂给真的 `frame()`。
   * `fps` 只决定"多久喂一帧"，`seconds` 决定喂多长——同一串时长换 fps 必须落回同一个 fx.state()。
   */
  advance(seconds, fps = 60) {
    const dtMs = 1000 / fps;
    const n = Math.max(0, Math.round(seconds * fps));
    const base = lastFrame || 1;
    for (let k = 0; k < n; k++) frame(base + (k + 1) * dtMs);
    return fx.state();
  },
  /** 落笔的编程等价物：走的正是指针抬起时那一句 game.stroke()。 */
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
  state: () => (game ? {
    ...game.state(),
    elapsedMs: clock(),
    view: view.name,
    daily: !!game.daily,
    paused,
    fx: fx.state(),
    sound: { muted: sound.muted, played: sound.played, fallbacks: sound.fallbacks, context: sound.contextState },
  } : null),
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
  //
  // 但**任何** rejection 都不得当成"这台机器不行"。真正的"没有这能力"在上面的
  // `if (!req)` 已经判完了；能走到这里就说明能力是有的，只是**这一次**没成：
  // 没有瞬时用户激活、iframe 的 allow 里缺 fullscreen、上一次请求还没结束导致的
  // AbortError、受限/headless 环境下的 TypeError……这些过一会儿再点就好。
  //
  // 上一版只把 NotAllowedError 排除在外，AbortError 与 TypeError 照样走进
  // unsupported()，于是自动化环境里一次被拒就把一颗好按钮**永久禁掉**，还对着玩家
  // 谎称"这个浏览器不提供元素全屏"。这与它想修的 NotAllowedError 是同一个错，
  // 只是换了错误名——所以这里改成一律不禁用，交给玩家下一次点击重试。
  const settle = (p) => { if (p && p.catch) p.catch(() => {}); };

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
      // 同 settle()：req 存在就说明能力在，不能因为这一次抛错就永久禁掉一颗好按钮
      // 并谎称不支持。保持可点，让玩家重试。
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
