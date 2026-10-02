// 声音层：一小撮合成音，没有采样文件。
//
// 三条口径写在这里，因为它们都是"看起来做了但没做"的高发区：
//   ① **真静音**：静音走 `AudioContext.suspend()`，并且 `play()` 在静音态直接返回——
//      不许只把 master gain 设成 0（振荡器节点照建、照排程，CPU 与延迟都在，只是听不见）；
//   ② **首次手势之后再开 AudioContext**：浏览器（含 iOS Safari）在用户碰过之前建的
//      context 一律是 `suspended`，那时候排程的声音会在一瞬间全部吐出来；
//   ③ **没有 context 也能活**：`AudioContext` 不存在（老浏览器、node 侧的加载对拍）时
//      整层降级成空操作，不许抛异常——这一层坏了不该让一盘棋开不了。
//
// 音量只有"响 / 不响"两档，所以没有滑块：静音开关的状态穿过 store 落到 localStorage。

const TONES = {
  wall: { f: 392, type: 'triangle', dur: 0.09, gain: 0.16 },
  merge: { f: 523.25, type: 'sine', dur: 0.10, gain: 0.14 },
  erase: { f: 233.08, type: 'sine', dur: 0.07, gain: 0.10 },
  hint: { f: 659.25, type: 'sine', dur: 0.13, gain: 0.15 },
  clash: { f: 155.56, type: 'sawtooth', dur: 0.16, gain: 0.13 },
  ui: { f: 440, type: 'sine', dur: 0.04, gain: 0.07 },
  win: { f: 783.99, type: 'triangle', dur: 0.42, gain: 0.20 },
};

export class Sound {
  constructor({ muted = false, onChange = null } = {}) {
    this._muted = !!muted;
    this.onChange = onChange;
    this.ctx = null;
    this.master = null;
    this.fallbacks = 0;
    // 排过多少次音：静音态必须一个都不涨，这是"真静音"唯一可复验的读数
    this.played = 0;
    // 真挂起/真恢复各调了几次：只有 gain=0 的假静音会留在这里两个都是 0
    this.suspends = 0;
    this.resumes = 0;
  }

  /** 给验闸台的一次性读数：全是标量，"静音做了"这件事只能从这里判，不能从注释判。 */
  snapshot() {
    return {
      muted: this._muted,
      played: this.played,
      suspends: this.suspends,
      resumes: this.resumes,
      fallbacks: this.fallbacks,
      context: this.contextState,
    };
  }

  get muted() {
    return this._muted;
  }

  /** 只有 context 真建成了才算 running；没有 context（未解锁/不支持）就是 idle。 */
  get contextState() {
    return this.ctx ? this.ctx.state : 'idle';
  }

  /** 首次用户手势里调用：建 context 并 resume。重复调用是廉价的。 */
  unlock() {
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext
      : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
    if (!Ctor) return null;
    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended' && !this._muted) {
      this.resumes++;
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => { this.fallbacks++; });
    }
    return this.ctx;
  }

  setMuted(on) {
    const next = !!on;
    if (next === this._muted) return next;
    this._muted = next;
    if (this.ctx) {
      // 静音 = 挂起整张图；解除 = 恢复。两者都不许留下排程中的节点。
      if (next) this.suspends++;
      else this.resumes++;
      const p = next ? this.ctx.suspend() : this.ctx.resume();
      if (p && p.catch) p.catch(() => { this.fallbacks++; });
    }
    if (this.onChange) this.onChange(next);
    return next;
  }

  toggle() {
    return this.setMuted(!this._muted);
  }

  /** 发一声。静音态**不建任何节点**（不是把 gain 压到 0）。 */
  play(name = 'ui') {
    return this.schedule(name, 0);
  }

  /**
   * 排一声：`at` 是距 `ctx.currentTime` 的秒数。
   * 音头 8 ms 起振 + 指数衰减——没有包络的方波在手机上就是"咔"一声爆音。
   */
  schedule(name, at = 0, freq = 1) {
    if (this._muted) return false;
    const tone = TONES[name] || TONES.ui;
    const ctx = this.unlock();
    if (!ctx) return false;
    if (ctx.state === 'suspended') return false; // 还没拿到手势授权，别把这一声排进队列
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.f * freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(tone.gain, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + tone.dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + tone.dur + 0.02);
    this.played++;
    return true;
  }

  /** 胜利那一声：同一个音色差三度/五度叠三次，每次错开 0.11 秒。 */
  fanfare() {
    [0, 4, 7].forEach((semi, k) => this.schedule('win', k * 0.11, Math.pow(2, semi / 12)));
    return !this._muted;
  }
}

export default Sound;
