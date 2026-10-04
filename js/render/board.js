// Canvas 渲染层：只把引擎给出的三态边画出来，不判任何东西。
//
// 这里没有一条边会被"算成错"：块的颜色来自 `pencil.components()`（沿同块边连通），
// 撞破的红调来自 `game.contradictions`（铅笔通道在玩家自己的线上推出来的矛盾），
// 盘面合不合法来自 `validate.invalidReason`。渲染与判据分开，图才不可能跟求解器吵起来。
//
// 命中测试与绘制住在同一个文件里，是因为它们必须用**同一套**数字：两套漂移就是
// "画对了地方、点下去是隔壁那条边"。手指落点折成一条边的规则是格内四象限
// （离哪条边界近就指哪条），所以每条内部边的可点区域都是一整格大小，不是几像素的细线。

import { MARKER_CHAR } from '../engine/counter.js';
import { SAME, UNKNOWN, WALL } from '../ui/game.js';

/** 颜色只有一份来源：css/game.css 的自定义属性。这里读它，不再抄一遍字面量。 */
const CSS_VARS = [
  'ink', 'ink-dim', 'ink-faint', 'surface', 'surface-lift', 'line', 'line-heavy',
  'accent', 'accent-edge', 'success', 'error', 'hint', 'mark', 'wall', 'unknown', 'font-mono',
];

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const p = {};
  const missing = [];
  for (const k of CSS_VARS) {
    const v = (cs.getPropertyValue(`--${k}`) || '').trim();
    if (!v) missing.push(k);
    p[k] = v;
  }
  // 少一条就当场炸：静默画成黑色比报错难查得多。
  if (missing.length) throw new Error(`css/game.css 缺少变量：${missing.map((m) => `--${m}`).join(' ')}`);
  return p;
}

export const Cell = { min: 44, max: 76, marker: 0.46 };

/** 引擎的记号字符表（`counter.js::MARKER_CHAR`）。渲染层不另立一套符号。 */
export const MARKER_GLYPH = MARKER_CHAR;

/** 44px 是手指的最小可信目标，不是审美：放不下就让盘子溢出、页面滚，也不许把格子缩。 */
export function layoutFor(w, h, availW, availH) {
  const pad = 16; // 外框、提示光带都要留出呼吸
  const fit = Math.min((availW - pad * 2) / w, (availH - pad * 2) / h);
  const cell = Math.max(Cell.min, Math.min(Cell.max, Math.floor(fit)));
  return { cell, boardW: cell * w, boardH: cell * h, pad, w, h };
}

const flip = (dir) => (dir === 0 ? 2 : dir === 2 ? 0 : dir === 1 ? 3 : 1);

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.palette = readPalette();
    this.geo = { cell: 0, x: 0, y: 0, w: 0, h: 0, dpr: 1, gw: 0, gh: 0 };
  }

  /** 第 mi 个记号所在块的颜色：色相按记号序号等分，几个记号几种色，天然不撞。 */
  tintOf(mi, total, alpha) {
    const hue = Math.round((mi * 360) / Math.max(1, total)) % 360;
    return `hsla(${hue}, 46%, 62%, ${alpha})`;
  }

  /** 系统主题会中途翻面（prefers-color-scheme），所以每次重排都重读一遍 CSS。 */
  refreshPalette() {
    this.palette = readPalette();
    return this.palette;
  }

  resize(game, availW, availH) {
    this.refreshPalette();
    const l = layoutFor(game.w, game.h, availW, availH);
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const box = { w: l.boardW + l.pad * 2, h: l.boardH + l.pad * 2 };
    this.canvas.style.width = `${box.w}px`;
    this.canvas.style.height = `${box.h}px`;
    this.canvas.width = Math.round(box.w * dpr);
    this.canvas.height = Math.round(box.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geo = { cell: l.cell, x: l.pad, y: l.pad, w: box.w, h: box.h, dpr, gw: game.w, gh: game.h };
    this.game = game;
    return this.geo;
  }

  cellXY(i) {
    const { cell, x, y, gw } = this.geo;
    return { x: x + (i % gw) * cell, y: y + ((i / gw) | 0) * cell, size: cell };
  }

  /** 一条边的几何：在哪条线上、沿哪个轴、多长。dir 0上 1右 2下 3左。 */
  segmentRect(i, dir) {
    const { cell, x, y, gw } = this.geo;
    const c = i % gw;
    const r = (i / gw) | 0;
    if (dir === 1) return { axis: 'v', x: x + (c + 1) * cell, y: y + r * cell, len: cell };
    if (dir === 3) return { axis: 'v', x: x + c * cell, y: y + r * cell, len: cell };
    if (dir === 2) return { axis: 'h', x: x + c * cell, y: y + (r + 1) * cell, len: cell };
    return { axis: 'h', x: x + c * cell, y: y + r * cell, len: cell };
  }

  neighbour(i, dir) {
    const { gw, gh } = this.geo;
    const c = i % gw;
    const r = (i / gw) | 0;
    if (dir === 0) return r > 0 ? i - gw : -1;
    if (dir === 2) return r < gh - 1 ? i + gw : -1;
    if (dir === 1) return c < gw - 1 ? i + 1 : -1;
    return c > 0 ? i - 1 : -1;
  }

  /** 屏幕点 → (格, 方向)：格内四象限各指一条边界；指到盘外就翻回同轴另一侧，再退到副轴。 */
  hitEdge(clientX, clientY) {
    const { cell, x, y, gw, gh } = this.geo;
    if (!cell) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cf = (clientX - rect.left - x) / cell;
    const rf = (clientY - rect.top - y) / cell;
    if (cf < 0 || rf < 0 || cf >= gw || rf >= gh) return null;
    const c = Math.min(gw - 1, Math.floor(cf));
    const r = Math.min(gh - 1, Math.floor(rf));
    const i = r * gw + c;
    const fx = cf - c;
    const fy = rf - r;
    const horizFirst = Math.min(fy, 1 - fy) <= Math.min(fx, 1 - fx);
    const horiz = fy < 0.5 ? 0 : 2;
    const vert = fx < 0.5 ? 3 : 1;
    const wants = horizFirst ? [horiz, flip(horiz), vert, flip(vert)] : [vert, flip(vert), horiz, flip(horiz)];
    for (const dir of wants) {
      if (this.neighbour(i, dir) >= 0) return { i, dir };
    }
    return null;
  }

  draw(game, { pulse = null, preview = null } = {}) {
    const P = this.palette;
    const { ctx, geo } = this;
    const { cell, gw } = geo;
    if (!cell || !game) return;
    const won = game.status === 'won';
    const total = game.markers.length;
    const { lab, markerOf } = game;

    ctx.clearRect(0, 0, geo.w, geo.h);
    round(ctx, 0, 0, geo.w, geo.h, 14);
    ctx.fillStyle = P.surface;
    ctx.fill();

    // 块的颜色 = 它领的那个记号的颜色（记号序号是稳定身份，合并途中不会跳色）。
    // 没记号的一片不上色（还没归属）；含两个记号的一片上错色（那是 R1 报的事，不是这里编的）。
    for (let i = 0; i < game.N; i++) {
      const m = markerOf[lab[i]];
      let fill = null;
      if (m && m.cnt > 1) fill = withAlpha(P.error, 0.16);
      else if (m && m.cnt === 1) fill = this.tintOf(m.mi, total, won ? 0.3 : 0.18);
      else if (game.st.markerAt[i] >= 0) fill = withAlpha(P.accent, 0.07);
      if (!fill) continue;
      const r = this.cellXY(i);
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, cell, cell);
    }

    // 细线：未定是虚线、墙是实线；"同块"什么都不画，所以合并起来的地方自然连成一片。
    ctx.lineWidth = 1;
    for (const e of game.edges) {
      const v = game.valueAt(e.i, e.dir);
      if (v === SAME) continue;
      ctx.strokeStyle = v === WALL ? P.line : P.unknown;
      ctx.setLineDash(v === UNKNOWN ? [Math.max(3, cell * 0.12), Math.max(3, cell * 0.14)] : []);
      this.strokeSegment(e.i, e.dir);
    }
    ctx.setLineDash([]);

    // 玩家画的墙盖在细线之上：粗、圆头，赢了变绿。
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, cell * 0.11);
    ctx.strokeStyle = won ? P.success : P['accent-edge'];
    for (const e of game.edges) {
      if (game.valueAt(e.i, e.dir) !== WALL) continue;
      this.strokeSegment(e.i, e.dir);
    }
    ctx.lineCap = 'butt';

    // 外框永远是墙（pencil.js 把盘外当边界墙，这里就照那个口径画）。
    ctx.lineWidth = Math.max(2.5, cell * 0.09);
    ctx.strokeStyle = won ? P.success : P.wall;
    ctx.strokeRect(geo.x, geo.y, cell * gw, cell * this.geo.gh);

    // 记号：字符直接用 `counter.js::MARKER_CHAR`。
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(cell * Cell.marker)}px ${P['font-mono']}`;
    for (let mi = 0; mi < total; mi++) {
      const m = game.markers[mi];
      const p = this.cellXY(m.r * gw + m.c);
      ctx.fillStyle = P.ink;
      ctx.fillText(MARKER_GLYPH[m.type], p.x + cell / 2, p.y + cell / 2);
    }

    // 拖动中的预览：只是油漆，不是墨。
    if (preview && preview.segs && preview.segs.length) {
      ctx.strokeStyle = P.hint;
      ctx.lineWidth = Math.max(3, cell * 0.1);
      ctx.setLineDash([Math.max(4, cell * 0.18), Math.max(3, cell * 0.12)]);
      for (const s of preview.segs) this.strokeSegment(s.i, s.dir);
      ctx.setLineDash([]);
    }

    // 提示/矛盾刚点名的那一条边——UI 唯一被允许说"看这里"的地方。
    if (pulse && pulse.i != null && pulse.dir != null && this.neighbour(pulse.i, pulse.dir) >= 0) {
      ctx.strokeStyle = pulse.color || P.hint;
      ctx.lineCap = 'round';
      // 先描两格的框，**最后**描那条光带。两格框与光带是同一个颜色，旧顺序是"光带→框→框"，
      // 于是光带正中那一行/列被两次**半覆盖**的同色描边盖过：Skia 按线性空间混合再折回 8 位，
      // 每一下都掉一个量化位（实测 y=168 那行整行读成 #a87400，而 163~167、169~171 是 #a97400；
      // 竖边在 x=168 那列同理读成 #a97300）。把光带挪到最后一次描边，它自己中心线上的那些像素
      // 就是 100% 覆盖 → 读回来逐位等于 --hint，"这条边被 --hint 光带画住"那句话才真是可测的。
      ctx.lineWidth = Math.max(2, cell * 0.06);
      for (const j of [pulse.i, this.neighbour(pulse.i, pulse.dir)]) {
        const r = this.cellXY(j);
        round(ctx, r.x + 2, r.y + 2, cell - 4, cell - 4, 6);
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(4, cell * 0.16);
      this.strokeSegment(pulse.i, pulse.dir, true);
      ctx.lineCap = 'butt';
    }
  }

  strokeSegment(i, dir, full = false) {
    const s = this.segmentRect(i, dir);
    const inset = full ? 0 : Math.max(3, this.geo.cell * 0.1);
    this.ctx.beginPath();
    if (s.axis === 'v') { this.ctx.moveTo(s.x, s.y + inset); this.ctx.lineTo(s.x, s.y + s.len - inset); }
    else { this.ctx.moveTo(s.x + inset, s.y); this.ctx.lineTo(s.x + s.len - inset, s.y); }
    this.ctx.stroke();
  }
}

function withAlpha(color, alpha) {
  // CSS 里这些是 #rrggbb；canvas 要半透明就自己换写法，拿不动就原样交回去。
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return color;
}

function round(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
