// 动效层：**所有**位移、衰减、寿命都按秒（dt）算，没有一处按"帧"算。
//
// 为什么单独一层：盘面本身是纯函数式的（`board.draw()` 只读 `game` 的状态），
// 而"墨迹未干"的那点动——未定边的行进虚线、提示光带的呼吸、落笔与胜利的墨点——
// 需要一份随时间推进的可变状态。把它关在这个文件里，渲染层就仍然只画"给它的数字"。
//
// 三条纪律：
//   ① 帧率无关：位移 `p.x += p.vx * dt`，阻尼 `p.vx *= Math.pow(DRAG, dt * 60)`，
//      概率 `1 - Math.pow(1 - p, dt * 60)`。写 `*= 0.94` 或 `Math.random() < 0.02`
//      的量只在 60 Hz 成立，掉到 30 Hz 就慢一半——那是缺陷不是风格。
//   ② 自带 LCG，不用 `Math.random()`：动效要能在对拍脚本里逐位复现，
//      同一粒种子 + 同一串 dt 必须落回同一批像素。
//   ③ `prefers-reduced-motion: reduce` 是真的分支：虚线不前进、不喷粒子、
//      提示光带退化成一条静定色带（`pulse.t` 钉在峰值），而不是"照样动但快一点"。
//
// 暂停：`step()` 由外层调用，暂停期间外层根本不调它——所以这层的时间不会偷偷推进。

const DRAG = 0.94;        // 每秒 60 帧口径的阻尼系数（用时再按 dt 折算）
const GRAVITY = 340;      // px/s²
const MAX_DT = 0.05;      // 单帧上限：切后台回来那一下不许把粒子瞬移走
const DASH_SPEED = 26;    // 未定边虚线行进速度，px/s

/** 确定性随机：数值配方是常见的 LCG（glibc 的常数），0 ≤ rnd() < 1。 */
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export class Fx {
  constructor({ seed = 20260926, motion = true } = {}) {
    this.seed = seed >>> 0;
    this.rnd = lcg(this.seed);
    this.motion = !!motion;
    this.particles = [];
    this.pulse = null;
    this.clock = 0;        // 累计虚拟秒：对拍脚本就盯这一条与 dashPhase
    this.dashPhase = 0;    // 未定边虚线的行进相位（px）
    this.steps = 0;
    this.bursts = 0;
    this.layer = null;     // 粒子住的叠加画布（attach() 之后才有）
    this.lctx = null;
    this.sprite = null;
    this.spriteReady = false;
    this.layerW = 0;
    this.layerH = 0;
  }

  /** 系统动效偏好会中途改，所以外层可以反复调它。关掉时把已有的粒子当场清掉。 */
  setMotion(on) {
    this.motion = !!on;
    if (!this.motion) {
      this.particles.length = 0;
      this.dashPhase = 0;
    }
    return this.motion;
  }

  /** 重开一局：时钟、粒子、脉冲全部复位（不许只清粒子留着相位）。 */
  reset() {
    this.rnd = lcg(this.seed);
    this.particles.length = 0;
    this.pulse = null;
    this.clock = 0;
    this.dashPhase = 0;
    this.steps = 0;
    this.bursts = 0;
  }

  /** 这一帧要不要继续画：动效开着就有活，关着就只在有脉冲/粒子时才有活。 */
  get active() {
    return this.motion || this.particles.length > 0 || !!this.pulse;
  }

  /**
   * 推进一帧。`dt` 是**真实经过的秒数**，不是"一帧"。
   * 返回值是"这一帧有没有东西变了"，外层据此决定要不要重画。
   */
  step(dt) {
    const s = Math.min(MAX_DT, Math.max(0, Number(dt) || 0));
    this.clock += s;
    this.steps++;
    let dirty = s > 0;
    if (this.motion) this.dashPhase = (this.dashPhase + DASH_SPEED * s) % 1000;
    const list = this.particles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= s;
      if (p.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      p.vy += GRAVITY * s;
      const k = Math.pow(DRAG, s * 60);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * s;
      p.y += p.vy * s;
    }
    if (this.pulse) {
      this.pulse.t += s;
      if (this.pulse.t >= this.pulse.life) this.pulse = null;
    }
    return dirty;
  }

  /** 提示/矛盾那一条边的光带。关掉动效时 `t` 钉在峰值：仍然是"看这里"，但不呼吸。 */
  setPulse(i, dir, { life = 1.6, color = null } = {}) {
    this.pulse = { i, dir, t: this.motion ? 0 : life * 0.4, life, color };
    return this.pulse;
  }

  /**
   * 喷一撮墨点。`n` 是**这一撮的总数**（不是"每帧的概率"），所以掉帧不会少喷。
   * 关掉动效就直接不喷——胜利时盘面照样变绿，只是没有飞散的墨。
   */
  burst(x, y, n = 10, { hue = 168, spread = 190, up = 120, size = 3 } = {}) {
    if (!this.motion) return 0;
    const count = Math.max(0, Math.round(n));
    for (let k = 0; k < count; k++) {
      const a = this.rnd() * Math.PI * 2;
      const v = spread * (0.35 + 0.65 * this.rnd());
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - up,
        life: 0.5 + this.rnd() * 0.7,
        maxLife: 1.2,
        size: size * (0.6 + this.rnd() * 0.9),
        hue: hue + (this.rnd() * 40 - 20),
      });
    }
    this.bursts++;
    return count;
  }

  /** 沿一条边喷：落笔与提示用，起点是那条边的中点。 */
  burstSegment(midX, midY, axis, n, opts) {
    const along = (this.rnd() - 0.5) * (opts && opts.len ? opts.len : 40);
    const off = (this.rnd() - 0.5) * 8;
    return this.burst(midX + (axis === 'v' ? off : along), midY + (axis === 'v' ? along : off),
      n, opts);
  }

  /** 光带这一帧该多粗/多亮：正弦呼吸，关掉动效就是恒定值。 */
  pulseEnvelope() {
    if (!this.pulse) return 0;
    if (!this.motion) return 1;
    const t = this.pulse.t / this.pulse.life;
    return Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
  }

  /**
   * 挂一张独立的叠加画布。
   * 为什么不在 #board 上直接喷粒子：浏览器闸按**精确色**取盘上的点（格心必须逐位等于
   * --surface、光带中心线必须逐位等于 --hint），任何一层加法混合的墨点都会把这些读数带歪。
   * 所以粒子住在盘面上面那张 pointer-events:none 的层里，盘本身仍然是判据的纯函数。
   */
  attach(canvas, spriteSrc = 'assets/sprites/dust-burst.png') {
    this.layer = canvas || null;
    this.lctx = this.layer && this.layer.getContext ? this.layer.getContext('2d') : null;
    this.sprite = null;
    this.spriteReady = false;
    if (spriteSrc && typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = () => { this.sprite = img; this.spriteReady = true; };
      img.onerror = () => { this.spriteReady = false; }; // 拿不到图就退回画素圆点，不抛
      img.src = spriteSrc;
    }
    return !!this.lctx;
  }

  /** 叠加层跟盘框同尺寸（CSS 像素 + dpr 后备缓冲），坐标于是与 canvas 那一套对齐。 */
  resize(w, h, dpr = 1) {
    if (!this.layer) return null;
    this.layer.style.width = `${w}px`;
    this.layer.style.height = `${h}px`;
    this.layer.width = Math.max(1, Math.round(w * dpr));
    this.layer.height = Math.max(1, Math.round(h * dpr));
    if (this.lctx) this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layerW = w;
    this.layerH = h;
    return { w, h, dpr };
  }

  /** 清一遍叠加层再画这一帧的粒子；没有叠加层时什么也不做（对拍脚本只读数值）。 */
  render() {
    if (!this.lctx) return 0;
    this.lctx.clearRect(0, 0, this.layerW || 0, this.layerH || 0);
    if (!this.particles.length) return 0;
    return this.draw(this.lctx, { sprite: this.spriteReady ? this.sprite : null });
  }

  draw(ctx, { sprite = null, alpha = 1 } = {}) {
    if (!this.particles.length) return 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife)) * alpha;
      if (a <= 0.01) continue;
      if (sprite) {
        ctx.globalAlpha = a;
        const d = p.size * 6;
        ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `hsla(${Math.round(p.hue)}, 62%, 66%, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return this.particles.length;
  }

  /** 给对拍脚本与验闸台读的那一面：全是可比的标量，不含函数。 */
  state() {
    let sumX = 0;
    let sumY = 0;
    for (const p of this.particles) {
      sumX += p.x;
      sumY += p.y;
    }
    return {
      clock: this.clock,
      dashPhase: this.dashPhase,
      steps: this.steps,
      particles: this.particles.length,
      sumX,
      sumY,
      pulseT: this.pulse ? this.pulse.t : 0,
      bursts: this.bursts,
      motion: this.motion,
    };
  }
}

export const FxDefaults = { DRAG, GRAVITY, MAX_DT, DASH_SPEED };
export default Fx;
