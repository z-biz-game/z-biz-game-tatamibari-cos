// 浏览器闸里跑的场景：注入页面后由 tools/playtest.cjs 的 `scenario <名>` 调 window.__scn.<名>()。
//
// 与数墙那份同名同规矩，内容是本仓自己的：
//   * 每条断言只写一次 `ck(名, 条件, 细节)`，报告靠 `report()` 交回 `rows/fail`，
//     机器可读的那一行 `RESULT <json>` 由 playtest.cjs 打在 stdout 最后一行；
//   * 页内不引 Math.random / Date.now：每一盘都由显式 seed 定位（见 >>>FIXTURE），
//     而那一截同时被 tools/verify.sh 用 node 从**同一批 js/engine 与 js/ui 模块**重算一遍 ——
//     夹具是 node 的出货，不是 Chrome 的；两边不再可能是同一份代码的自我确认；
//   * 名字表（工具名/值名/边名）一律从 js/ui/game.js 现取（`mod()`），不在闸里抄第二份中文；
//   * 手势全走 DOM 事件：pointerdown/pointermove/pointerup 与 button.click()，
//     不调 `window.tatamibari.stroke()`——那个 API 绕过命中测试，用它就等于没测命中。
//
// 这一段跑在 js/main.js **之前**（Page.addScriptToEvaluateOnNewDocument），所以启动期的未捕获异常
// 与资源 404 抓得到：那是"浏览器闸要抓的第一类 bug"，页面自己永远打印不出来。
// >>>FIXTURE
const FIXTURE = [
  {
    kind: "seed",
    origin: "scn|newbie|0",
    seed: "scn|newbie|0",
    tries: 1,
    tier: "newbie",
    tierName: "入门",
    band: "74,187",
    w: 4,
    h: 4,
    edges: 24,
    score: 127,
    passes: 3,
    steps: 24,
    maxBlock: 3,
    grid: ".-.+/..../|||./+.+|",
    markers: "0,1,0 0,3,2 2,0,1 2,1,1 2,2,1 3,0,2 3,2,2 3,3,1",
    sols: 1,
    nodes: 32,
    agree: "true",
    scriptLen: 24,
    script: "R1 记号互斥|8|1|1; R1 记号互斥|8|2|1; R1 记号互斥|9|1|1; R1 记号互斥|10|2|1; R1 记号互斥|14|1|1; R3 区域尺寸推理|8|0|2; R3 区域尺寸推理|12|1|1; R3 区域尺寸推理|14|3|1; R3 区域尺寸推理|15|0|2; R5 记号可达|13|0|2; R6 候选形状收敛|4|1|1; R6 候选形状收敛|5|1|1; R6 候选形状收敛|6|1|1; R6 候选形状收敛|6|2|2; R6 候选形状收敛|10|1|1; R6 候选形状收敛|1|2|1; R6 候选形状收敛|2|1|1; R6 候选形状收敛|3|2|1; R7 孤岛记号数|5|2|2; R7 孤岛记号数|7|2|2; R2 窗口构型表|2|2|2; R2 窗口构型表|1|1|1; R3 区域尺寸推理|1|3|2; R3 区域尺寸推理|0|2|1",
    freeWalls: "R1 记号互斥|8|1|1; R1 记号互斥|8|2|1; R1 记号互斥|9|1|1; R1 记号互斥|10|2|1; R1 记号互斥|14|1|1",
    wallsWant: 16,
    mergedWant: 8,
    saveOps: "t:8:1:1 h d:9/1,10/1:1 t:5:2:2 h",
    saveMoves: 3,
    saveHints: 2,
    saveDecided: 6,
    saveUnknown: 18,
    saveWalls: 5,
    saveMerged: 1,
    saveRegions: 15,
    saveClashes: 0,
    saveStatus: "playing",
    saveRleRight: "0x8,1x3,0x5",
    saveRleDown: "0x5,2x1,0x2,1x1,0x1,1x1,0x5",
    undoCursorProbe: "8/1 cursor=24 status=won unknown=0 hints=25"
  },
  {
    kind: "seed",
    origin: "scn|easy|0",
    seed: "scn|easy|0",
    tries: 1,
    tier: "easy",
    tierName: "简单",
    band: "91,220",
    w: 4,
    h: 5,
    edges: 31,
    score: 120,
    passes: 2,
    steps: 31,
    maxBlock: 6,
    grid: ".-.-/...|/..-./-.|./.-..",
    markers: "0,1,0 0,3,0 1,3,1 2,2,0 3,0,0 3,2,1 4,1,0",
    sols: 1,
    nodes: 16,
    agree: "true",
    scriptLen: 31,
    script: "R1 记号互斥|3|2|1; R1 记号互斥|10|2|1; R3 区域尺寸推理|3|3|2; R6 候选形状收敛|1|1|1; R6 候选形状收敛|2|2|1; R6 候选形状收敛|6|1|1; R6 候选形状收敛|7|2|2; R6 候选形状收敛|10|1|1; R6 候选形状收敛|8|2|1; R6 候选形状收敛|9|2|1; R6 候选形状收敛|12|1|2; R6 候选形状收敛|12|2|1; R6 候选形状收敛|13|1|1; R6 候选形状收敛|13|2|1; R6 候选形状收敛|14|1|1; R6 候选形状收敛|14|2|2; R6 候选形状收敛|17|1|1; R6 候选形状收敛|18|1|1; R6 候选形状收敛|0|1|2; R6 候选形状收敛|0|2|1; R6 候选形状收敛|1|2|1; R6 候选形状收敛|9|1|2; R6 候选形状收敛|16|1|2; R7 孤岛记号数|4|1|2; R7 孤岛记号数|4|2|2; R7 孤岛记号数|5|1|2; R7 孤岛记号数|5|2|2; R7 孤岛记号数|8|1|2; R7 孤岛记号数|6|2|2; R7 孤岛记号数|11|2|2; R7 孤岛记号数|15|2|2",
    freeWalls: "R1 记号互斥|3|2|1; R1 记号互斥|10|2|1",
    wallsWant: 16,
    mergedWant: 15
  },
  {
    kind: "seed",
    origin: "scn|hard|0",
    seed: "scn|hard|0",
    tries: 1,
    tier: "hard",
    tierName: "困难",
    band: "122,313",
    w: 5,
    h: 6,
    edges: 49,
    score: 138,
    passes: 2,
    steps: 49,
    maxBlock: 12,
    grid: "....-/..|../..+../..+.|/|.|../...-.",
    markers: "0,4,0 1,2,1 2,2,2 3,2,2 3,4,1 4,0,1 4,2,1 5,3,0",
    sols: 1,
    nodes: 34,
    agree: "true",
    scriptLen: 49,
    script: "R1 记号互斥|7|2|1; R1 记号互斥|12|2|1; R1 记号互斥|17|2|1; R3 区域尺寸推理|12|1|1; R3 区域尺寸推理|12|3|1; R3 区域尺寸推理|17|1|1; R3 区域尺寸推理|17|3|1; R6 候选形状收敛|3|1|2; R6 候选形状收敛|3|2|1; R6 候选形状收敛|4|2|1; R6 候选形状收敛|1|1|1; R6 候选形状收敛|2|1|1; R6 候选形状收敛|2|2|2; R6 候选形状收敛|6|1|1; R6 候选形状收敛|7|1|1; R6 候选形状收敛|21|1|1; R6 候选形状收敛|22|1|1; R6 候选形状收敛|22|2|2; R6 候选形状收敛|26|1|1; R6 候选形状收敛|27|1|1; R6 候选形状收敛|23|2|1; R6 候选形状收敛|24|2|1; R6 候选形状收敛|28|1|2; R7 孤岛记号数|0|1|2; R7 孤岛记号数|0|2|2; R7 孤岛记号数|1|2|2; R7 孤岛记号数|5|1|2; R7 孤岛记号数|5|2|2; R7 孤岛记号数|6|2|2; R7 孤岛记号数|10|1|2; R7 孤岛记号数|10|2|2; R7 孤岛记号数|11|2|2; R7 孤岛记号数|15|1|2; R7 孤岛记号数|15|2|2; R7 孤岛记号数|16|2|2; R7 孤岛记号数|20|1|2; R7 孤岛记号数|20|2|2; R7 孤岛记号数|21|2|2; R7 孤岛记号数|25|1|2; R7 孤岛记号数|8|1|2; R7 孤岛记号数|8|2|2; R7 孤岛记号数|9|2|2; R7 孤岛记号数|13|1|2; R7 孤岛记号数|13|2|2; R7 孤岛记号数|14|2|2; R7 孤岛记号数|18|1|2; R7 孤岛记号数|18|2|2; R7 孤岛记号数|19|2|2; R7 孤岛记号数|23|1|2",
    freeWalls: "R1 记号互斥|7|2|1; R1 记号互斥|12|2|1; R1 记号互斥|17|2|1",
    wallsWant: 19,
    mergedWant: 30
  }
];
// <<<FIXTURE

((w) => {
  // ---------------------------------------------------------------- 探针：启动期的错与 404
  const PROBE = { js: [], res: [] };
  w.__probe = PROBE;
  w.addEventListener('error', (ev) => {
    const t = ev && ev.target;
    if (t && t !== w && (t.tagName || t.src || t.href)) {
      PROBE.res.push(`${t.tagName || 'node'}:${t.src || t.href || ''}`);
    } else {
      PROBE.js.push(String((ev && (ev.message || ev.error)) || 'error'));
    }
  }, true);
  w.addEventListener('unhandledrejection', (ev) => PROBE.js.push('rejection: ' + String(ev.reason)));
  const realError = w.console.error;
  w.console.error = function () {
    PROBE.js.push('[console.error] ' + [].map.call(arguments, String).join(' '));
    return realError.apply(this, arguments);
  };

  // ---------------------------------------------------------------- 断言小台
  const rows = [];
  const ck = (test, cond, detail) => {
    rows.push({ test, pass: !!cond, detail: cond ? '' : String(detail === undefined ? '' : detail) });
  };
  const eq = (test, got, want) => ck(test, String(got) === String(want), `got ${got} / want ${want}`);
  const report = (extra) => {
    const out = { rows: rows.slice(), fail: rows.filter((r) => !r.pass).length, ...extra };
    rows.length = 0;
    return out;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const A = () => w.tatamibari;
  const EN = () => w.tatamibari.engine;
  const text = (node) => ((node || {}).textContent || '').trim();
  const bySeed = (origin) => FIXTURE.filter((f) => f.origin === origin)[0];

  /**
   * 动态 import 必须按 document.baseURI 解析：Pages 把本仓挂在 /z-biz-game-tatamibari-cos/ 下，
   * 斜杠开头的说明符会解到域名根上 404（本地"根形态"跑起来一切正常 —— 最坏的那种绿）。
   */
  const mod = (rel) => import(new URL(rel, document.baseURI).href);
  const fetchText = async (rel) => {
    const url = new URL(rel, document.baseURI).href;
    const res = await fetch(url);
    return { url, ok: res.ok, status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
  };

  const shown = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    if (!e) return false;
    return getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  };
  /** [hidden] 的兄弟仓踩过：元素自带 display:grid 会盖过 UA 那条 [hidden]{display:none}。 */
  const hiddenTight = (node) => {
    const e = typeof node === 'string' ? $(node) : node;
    return !!e && e.hidden && getComputedStyle(e).display === 'none' && e.getClientRects().length === 0;
  };

  const varOf = (name) => getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
  /** 把任意 CSS 颜色（#hex / rgb() / hsl()）折成 [r,g,b]，断言里只比 RGB 三元组。 */
  const rgbOf = (() => {
    let c2 = null;
    return (spec) => {
      if (!c2) c2 = document.createElement('canvas').getContext('2d');
      c2.canvas.width = c2.canvas.height = 1;
      c2.fillStyle = spec;
      c2.fillRect(0, 0, 1, 1);
      const d = c2.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
  })();
  const same3 = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const hexOf = (rgbArr) => '#' + rgbArr.map((v) => v.toString(16).padStart(2, '0')).join('');

  // ---------------------------------------------------------------- 盘面几何（全部读渲染层自己的数字）
  const geo = () => A().geometry().geo;
  const canvasRect = () => A().dom.canvas.getBoundingClientRect();
  const frameRect = () => A().dom.frame.getBoundingClientRect();
  const frameBox = () => {
    const r = frameRect();
    const cs = getComputedStyle(A().dom.frame);
    const bx = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const pd = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    return {
      left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
      top: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
      right: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
      bottom: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom),
      width: r.width - bx - pd,
      height: r.height - bx - pd,
    };
  };
  const slotKey = (i, dir) => {
    const k = A().game.slotOf(i, dir);
    return k ? `${k.arr}${k.k}` : null;
  };
  /** 一条内部边的两个命中取样点：左右（或上下）两个相邻格的象限里各一个，都应当折到同一条规范边。 */
  const hitPts = (i, dir) => {
    const g = geo();
    const r = canvasRect();
    const c = i % g.gw;
    const row = (i / g.gw) | 0;
    const k = 0.18;
    const at = (cx, cy) => ({ x: r.left + g.x + cx * g.cell, y: r.top + g.y + cy * g.cell });
    if (dir === 1) return [at(c + 1 - k, row + 0.5), at(c + 1 + k, row + 0.5)];
    if (dir === 3) return [at(c - k, row + 0.5), at(c + k, row + 0.5)];
    if (dir === 2) return [at(c + 0.5, row + 1 - k), at(c + 0.5, row + 1 + k)];
    return [at(c + 0.5, row - k), at(c + 0.5, row + k)];
  };
  /** 该边线上的取样点（沿边等分 n 段，跳过两端的 inset）：虚线要"至少一段有墨"才说得清。 */
  const alongEdge = (i, dir, n) => {
    const g = geo();
    const out = [];
    for (let s = 0; s <= n; s++) {
      const f = 0.1 + 0.8 * (s / n);
      const c = i % g.gw;
      const row = (i / g.gw) | 0;
      const pos = dir === 1 ? { x: g.x + (c + 1) * g.cell, y: g.y + row * g.cell + g.cell * f }
        : dir === 3 ? { x: g.x + c * g.cell, y: g.y + row * g.cell + g.cell * f }
          : dir === 2 ? { x: g.x + c * g.cell + g.cell * f, y: g.y + (row + 1) * g.cell }
            : { x: g.x + c * g.cell + g.cell * f, y: g.y + row * g.cell };
      out.push(pos);
    }
    return out;
  };
  /**
   * 一条边线上的逐像素取样：`t` 是沿线（去掉两端 inset）的位置，`x/y` 是那条线**自己**那一列/一行，
   * `bgX/bgY` 是同一处往正方向挪两像素 —— 那一个像素就是这条线的底。
   * 为什么底在正方向：块的颜色是 `fillRect(x, y, cell, cell)`，覆盖面是 [x, x+cell-1]，
   * 所以落在边界坐标上的那一个像素属于**后一格**（实测：x=92 那列的底是右边那格的 tint，
   * x=168 那列的底是白）。画错的底 = 断言跟着错，所以这里也是量的，不是猜的。
   */
  const lineSamples = (i, dir) => {
    const g = geo();
    const c = i % g.gw;
    const r = (i / g.gw) | 0;
    const inset = Math.max(3, g.cell * 0.1);
    const out = [];
    for (let t = Math.ceil(inset); t <= Math.floor(g.cell - inset); t++) {
      if (dir === 1 || dir === 3) {
        const x = g.x + (dir === 1 ? c + 1 : c) * g.cell;
        out.push({ t, x, y: g.y + r * g.cell + t, bgX: x + 2, bgY: g.y + r * g.cell + t });
      } else {
        const y = g.y + (dir === 2 ? r + 1 : r) * g.cell;
        out.push({ t, x: g.x + c * g.cell + t, y, bgX: g.x + c * g.cell + t, bgY: y + 2 });
      }
    }
    return out;
  };
  /**
   * 1px 的线落在整数坐标上，抗锯齿把它**正好劈成相邻两列各一半**：那一列上看见的是
   * "墨与底的 50% 混色"，永远不是 --unknown 那个三元组本身（实测 24 条未定边上
   * 精确等于 #8fa3bb 的像素是 0 个，而 50% 混色的像素成段出现）。所以这里拿混色去比，
   * 而不是拿精确色 —— 拿精确色比一条半覆盖的线，就是在断言一件不可能发生的事。
   */
  const halfMix = (ink, bg) => ink.map((n, k) => Math.round((n + bg[k]) / 2));

  const px = (x, y) => {
    const g = geo();
    const d = g.dpr;
    const p = A().dom.canvas.getContext('2d').getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data;
    return [p[0], p[1], p[2]];
  };
  /** 画布 CSS 坐标（不加成 rect 偏移）下的一个点 —— 取像素用。 */
  const pxAtRatio = (i, dir) => {
    const g = geo();
    const c = i % g.gw;
    const row = (i / g.gw) | 0;
    const mid = dir === 1 ? { x: g.x + (c + 1) * g.cell, y: g.y + row * g.cell + g.cell / 2 }
      : dir === 3 ? { x: g.x + c * g.cell, y: g.y + row * g.cell + g.cell / 2 }
        : dir === 2 ? { x: g.x + c * g.cell + g.cell / 2, y: g.y + (row + 1) * g.cell }
          : { x: g.x + c * g.cell + g.cell / 2, y: g.y + row * g.cell };
    return px(mid.x, mid.y);
  };
  const cellCentrePx = (i) => {
    const g = geo();
    return px(g.x + (i % g.gw) * g.cell + g.cell / 2, g.y + ((i / g.gw) | 0) * g.cell + g.cell / 2);
  };

  // ---------------------------------------------------------------- 真指针
  let PID = 1;
  const ptr = (type, p) => {
    A().dom.canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: PID, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: p.x, clientY: p.y,
    }));
  };
  /** 一次点：落在 (i,dir) 的第一侧（也就是这一格自己的那一象限）。 */
  const pointerTap = async (i, dir) => {
    PID++;
    const p = hitPts(i, dir)[0];
    ptr('pointerdown', p);
    ptr('pointerup', p);
    await wait(10);
  };
  /** 一笔拖：从 segs[0] 起笔，依次穿过后面每一条边，在最后一侧抬指。 */
  const pointerDrag = async (segs, throughSecondSide) => {
    PID++;
    const pts = segs.map((s) => hitPts(s.i, s.dir)[throughSecondSide ? 1 : 0]);
    ptr('pointerdown', pts[0]);
    for (let k = 1; k < pts.length; k++) ptr('pointermove', pts[k]);
    ptr('pointerup', pts[pts.length - 1]);
    await wait(10);
    return pts;
  };
  const clickBtn = async (sel) => {
    const b = $(sel);
    if (b) b.click();
    await wait(10);
    return !!b;
  };
  /** 工具值 → 按钮选择器（按钮在 DOM 里就那三枚，选不到就说明工具表与按钮对不上）。 */
  const toolBtnFor = (val) => (val === 1 ? '#tool-wall' : val === 2 ? '#tool-same' : '#tool-erase');

  // ---------------------------------------------------------------- 开局与清场
  const booted = async () => {
    for (let i = 0; i < 200 && !w.tatamibari; i++) await wait(25);
    if (!w.tatamibari) throw new Error('window.tatamibari 从来没出现 —— 页面带着测试面启动失败');
    return w.tatamibari;
  };
  /** 每个场景都从空档起：续档卡、纪录、累计数全来自 localStorage，不能靠上一个场景留的残骸绿过去。 */
  const wipe = async () => {
    await booted();
    A().store.reset();
    A().show('menu');
    await wait(40);
  };
  /** `begin()` 是 rAF 之后才出题的，所以必须等 `game` 真上台（这一步也是 busy 遮罩的活证）。 */
  const openUntil = async (origin) => {
    const f = bySeed(origin);
    const before = A().game;
    A().begin(f.tier, { seed: f.origin });
    for (let i = 0; i < 1200; i++) {
      await wait(25);
      const g = A().game;
      if (g && g !== before && g.puzzle.seed === f.seed) break;
      if (i === 1199) throw new Error(`出题没回来：${origin} / ${f.tier}`);
    }
    await wait(40);
    return A().game;
  };
  const S = () => A().state();
  /**
   * #pill-state 那句话就是接线层按 state() 拼出来的：`已定 k/N`，判据没过时再缀一句"尚未合法"
   * （js/main.js::syncHud）。期望值现从引擎的 illegal 推，不在闸里抄第二遍措辞 —— 抄一遍就会
   * 把"合法与否"这一半断言丢掉，而那一半正是这枚药丸存在的理由。
   */
  const pillWant = (s) => `已定 ${s.decided}/${s.edges}${s.illegal ? ' · 尚未合法' : ''}`;
  /** 状态行里的数字（措辞允许改，数字不许）：断言用"包含"，因为整句话就是这些数拼的。 */
  const lineHas = (hay, ...needles) => needles.every((n) => hay.includes(n));

  // ---------------------------------------------------------------- FIXTURE 的展开
  const scriptOf = (f) => f.script.split('; ').map((tok) => {
    const [rule, i, dir, want] = tok.split('|');
    return { rule, i: Number(i), dir: Number(dir), want: Number(want) };
  });
  const freeOf = (f) => (f.freeWalls ? f.freeWalls.split('; ').filter(Boolean).map((tok) => {
    const [rule, i, dir, want] = tok.split('|');
    return { rule, i: Number(i), dir: Number(dir), want: Number(want) };
  }) : []);

  // ================================================================ first：启动、选档页、DOM 面、空盘像素
  const first = async () => {
    const A0 = await booted();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    eq('window.tatamibari.version 是三段点分', /^\d+\.\d+\.\d+$/.test(A0.version) ? 'ok' : String(A0.version), 'ok');
    ck('启动期没有未捕获异常 / console.error', PROBE.js.length === 0, PROBE.js.join(' | ').slice(0, 500));
    ck('启动期没有加载失败的资源', PROBE.res.length === 0, PROBE.res.join(' | ').slice(0, 500));
    eq('document.readyState', document.readyState, 'complete');
    eq('启动后落在选档页', A0.view(), 'menu');
    ck('启动时还没有局面', A0.game === null, `game=${A0.game}`);

    // 资源全从文档自己的目录解出来（Pages 前缀形态就钉在这儿）
    const res = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /^https?:/.test(n));
    ck(`全部 ${res.length} 条资源都落在 baseURI 之下`, res.length >= 10 && res.every((n) => n.startsWith(document.baseURI)),
      `baseURI=${document.baseURI} 越界的：${res.filter((n) => !n.startsWith(document.baseURI)).join(' ')}`);
    const html = await fetchText('index.html');
    ck('index.html 从 baseURI 取到 200 且真是 HTML', html.ok && /text\/html/.test(html.type) && /<canvas id="board"/.test(html.body),
      `status=${html.status} type=${html.type} len=${html.body.length}`);
    const src = await fetchText('js/main.js');
    ck('js/main.js 从 baseURI 取到 200 且是 JS', src.ok && /javascript/.test(src.type) && /window\.tatamibari/.test(src.body),
      `status=${src.status} type=${src.type} len=${src.body.length}`);
    const css = await fetchText('css/game.css');
    ck('css/game.css 从 baseURI 取到 200 且带调色板', css.ok && /--accent-edge/.test(css.body), `status=${css.status} type=${css.type}`);

    // main.js 里每一个 `$('#id')` 都必须真的在 index.html 里存在（漏一个就是启动时 null、或点了没反应）
    const ids = [...new Set([...src.body.matchAll(/\$\('#([^']+)'\)/g)].map((m) => m[1]))];
    const htmlIds = [...new Set([...html.body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
    ck(`main.js 引用的 id 数量够多（读到 ${ids.length} 个）`, ids.length >= 40, ids.join(','));
    const missing = ids.filter((id) => !htmlIds.includes(id));
    ck('main.js 里每个 $("#id") 都在 index.html 里存在', missing.length === 0, `缺：${missing.join(' ')}`);
    const notLive = ids.filter((id) => !document.getElementById(id));
    ck('而且这些 id 在活 DOM 里也都在', notLive.length === 0, `缺：${notLive.join(' ')}`);
    const dupes = htmlIds.filter((id) => (html.body.match(new RegExp(`id="${id}"`, 'g')) || []).length > 1);
    ck('index.html 里没有重复 id', dupes.length === 0, dupes.join(' '));

    // 测试面交出来的那一把节点：逐个都得是文档里的真元素
    const domKeys = Object.keys(A0.dom).filter((k) => k !== 'toolBtns');
    const badDom = domKeys.filter((k) => {
      const n = A0.dom[k];
      return !(n instanceof Element) || !document.contains(n) || !n.id || !htmlIds.includes(n.id);
    });
    ck(`dom 面里的 ${domKeys.length} 个节点都是 index.html 里的真元素`, badDom.length === 0, `坏：${badDom.join(' ')}`);
    ck('三枚工具按钮存在且写着引擎给的工具名', ['tool-wall', 'tool-same', 'tool-erase'].every((id) => {
      const n = document.getElementById(id);
      const val = id === 'tool-wall' ? 1 : id === 'tool-same' ? 2 : 0;
      return n && n.textContent.includes(G.TOOL_NAME[val]);
    }), ['tool-wall', 'tool-same', 'tool-erase'].map((id) => `${id}="${text('#' + id)}"`).join(' | ') + ` 名字表=${JSON.stringify(G.TOOL_NAME)}`);

    // 选档页：五档卡片 + 下拉 + 纪录表 + 累计 + 不出货那一句
    const TIERS = A0.engine.TIERS;
    eq('#tier-list 的卡片数 = TIERS 数', document.querySelectorAll('#tier-list .tier-btn').length, TIERS.length);
    eq('#tier-pick 的 option 数 = TIERS 数', A0.dom.tierPick.options.length, TIERS.length);
    eq('#tier-pick 默认落在第二档', A0.dom.tierPick.value, TIERS[1].key);
    let cardBad = [];
    TIERS.forEach((t, k) => {
      const btn = document.querySelectorAll('#tier-list .tier-btn')[k];
      const want = [t.name, `${t.size[0]}×${t.size[1]}`, `${t.band[0]}–${t.band[1]}`, `${t.struct.minRegions}`, `${t.tries}`];
      const s = text(btn);
      if (!want.every((x) => s.includes(x))) cardBad.push(`${t.key}:"${s.slice(0, 80)}"`);
    });
    ck('每张档位卡写着名字/尺寸/实测 band/结构下限/出货上限', cardBad.length === 0, cardBad.join(' | '));
    eq('#best-list 的行数 = TIERS 数', document.querySelectorAll('#best-list li').length, TIERS.length);
    ck('空档时每一行都是"还没有纪录"', [...document.querySelectorAll('#best-list li')].every((li) => li.textContent.includes('还没有纪录')),
      [...document.querySelectorAll('#best-list li')].map((li) => li.textContent.trim()).join(' | '));
    eq('累计行从 0 起', text(A0.dom.totalsLine), '累计：开局 0 盘 · 完成 0 盘 · 用过提示 0 次');
    const un = EN().UNSHIPPABLE;
    ck('#unshippable-note 逐条念出不出货的尺寸', un.every((u) => text(A0.dom.unshippable).includes(`${u.size[0]}×${u.size[1]}`)), text(A0.dom.unshippable).slice(0, 200));
    ck('页脚那句承诺写着第二条通道与 limitSolutions', (() => { const s = text($('#foot')); return s.includes('limitSolutions: 2') && s.includes('countAnchored') && s.includes('UNSHIPPABLE'); })(), text($('#foot')).slice(0, 200));
    eq('页脚可见', shown('#foot'), true);
    ck('存档键名来自 js/store.js（不是抄的）', (() => { const k = A0.engine.SAVE_KEY; return typeof k === 'string' && k.startsWith('tatamibari.') && !(k in localStorage); })(), `key=${A0.engine.SAVE_KEY} ls=${Object.keys(localStorage).join(',')}`);

    // [hidden] 那一族：隐藏时必须真的没有矩形
    const hiddenIds = ['#view-game', '#busy', '#win-veil', '#resume-card', '#board-preview'];
    const looseHidden = hiddenIds.filter((sel) => !hiddenTight(sel));
    ck(`选档页上 ${hiddenIds.length} 个 [hidden] 区块都真的收起来了`, looseHidden.length === 0,
      looseHidden.map((s) => `${s} display=${getComputedStyle($(s)).display} rects=${$(s).getClientRects().length}`).join(' | '));
    ck('选档页可见、对局页收起', shown('#view-menu') && hiddenTight('#view-game'), `menu=${shown('#view-menu')} game=${getComputedStyle(A0.dom.viewGame).display}`);
    // 控件在 hidden 的对局页里必须**一个矩形都没有**：这一条测的是 [hidden] 会不会被元素自带的
    // display:grid/flex 顶穿（兄弟仓踩过的那颗雷）。上一版这里写反了（筛"矩形小于 8px"再断言
    // 筛出来的是空的），那等于断言"藏着的时候仍然占地方"，与它自己的名字相反。
    const ctlIds = ['tool-wall', 'tool-same', 'tool-erase', 'btn-hint', 'btn-prune', 'btn-undo'];
    const stillBoxed = ctlIds.filter((id) => document.getElementById(id).getClientRects().length > 0);
    ck(`对局页那 ${ctlIds.length} 枚控件在隐藏容器里一个矩形都没有`, stillBoxed.length === 0,
      stillBoxed.map((id) => `${id} rects=${document.getElementById(id).getClientRects().length} display=${getComputedStyle(document.getElementById(id)).display}`).join(' | '));

    // ---- 开局：busy 遮罩、HUD、空盘像素与命中
    const t0 = Date.now();
    A0.begin('newbie', { seed: 'scn|newbie|0' });
    ck('begin() 之后先把"正在出题"画出来（rAF 才跑生成器）', shown('#busy') && A0.game === null && text(A0.dom.busyText).length > 10 && A0.dom.canvas.classList.contains('busy'),
      `busy=${getComputedStyle(A0.dom.busy).display} text="${text(A0.dom.busyText).slice(0, 40)}" cls=${A0.dom.canvas.className}`);
    eq('出题期间落在对局页', A0.view(), 'game');
    const g = await (async () => {
      for (let i = 0; i < 1200; i++) {
        await wait(25);
        if (A0.game && A0.game.puzzle.seed === f.seed) break;
      }
      return A0.game;
    })();
    const genMs = Date.now() - t0;
    ck('出题在合理墙钟内完成（4×4 那一档）', genMs < 20000, `${genMs} ms`);
    ck('出题结束后 busy 收起来、画布去掉 busy 类', hiddenTight('#busy') && !A0.dom.canvas.classList.contains('busy'),
      `busy=${getComputedStyle(A0.dom.busy).display} cls=${A0.dom.canvas.className}`);
    eq('盘面 seed 与 node 侧夹具一致（跨引擎那一钉）', g.puzzle.seed, f.seed);
    eq('尺寸', `${g.w}×${g.h}`, `${f.w}×${f.h}`);
    eq('记号盘逐格一致', g.puzzle.grid.join('/'), f.grid);
    eq('记号集（r,c,type）一致', g.markers.map((m) => `${m.r},${m.c},${m.type}`).join(' '), f.markers);
    eq('难度分', g.puzzle.score, f.score);
    eq('铅笔轮数', g.puzzle.passes, f.passes);
    eq('内部边数', g.edges.length, f.edges);
    eq('提示序列逐条一致', g.script.map((x) => `${x.rule}|${x.i}|${x.dir}|${x.want}`).join('; '), f.script);
    ck('integrity 为 null：空盘推得完且序列覆盖每一条内部边', g.integrity === null && g.scriptSolved && g.scriptCovers, `integrity=${g.integrity} solved=${g.scriptSolved} covers=${g.scriptCovers}`);
    eq('两条通道逐边一致', A0.state().agree, true);
    eq('浏览器里再数一遍：解的个数', A0.state().sols, f.sols);
    eq('浏览器里再数一遍：穷举节点数', A0.state().nodes, f.nodes);
    eq('空盘上 R1 那一眼墙的条数', g.freeWalls.length, freeOf(f).length);

    const s = S();
    eq('#hud-tier 写着档名', text(A0.dom.tier), f.tierName);
    eq('#hud-size', text(A0.dom.size), `${f.w}×${f.h}`);
    eq('#hud-seed', text(A0.dom.seed), f.seed);
    eq('#hud-score 带档名与 band', text(A0.dom.score), `${f.score}（档带 ${f.band.split(',')[0]}–${f.band.split(',')[1]}）`);
    eq('#hud-blocks = 块数/记号数', text(A0.dom.blocks), `${s.regions}/${s.markers}`);
    eq('空盘上每格自成一块', `${s.regions}/${s.markers}`, `${f.w * f.h}/${f.markers.split(' ').length}`);
    eq('#hud-unknown', text(A0.dom.unknown), f.edges);
    eq('#hud-walls 从 0 起', text(A0.dom.walls), 0);
    eq('#hud-merged 从 0 起', text(A0.dom.merged), 0);
    eq('#hud-moves 从 0 起', text(A0.dom.moves), 0);
    eq('#hud-hints 从 0 起', text(A0.dom.hints), 0);
    eq('#hud-clash 从 0 起', text(A0.dom.clash), 0);
    eq('#hint-left 剩整条序列', text(A0.dom.hintLeft), `剩 ${f.scriptLen}`);
    eq('#pill-state 已定 0/N（空盘不合法，所以那句必须带上判据未过）', text(A0.dom.pillState), pillWant(s));
    // 旧写法是 `eq(标签, text(...).startsWith(...), text(...))`：eq 比的是 String(got)===String(want)，
    // 这里 got 是布尔、want 是整句话，String(true)==='已定 0/24 · 尚未合法' 永远为假 —— 这条
    // 无论产品输出什么都过不去。打头的形状才是这条要测的事，所以拿 ck 断言那个条件，
    // 并把**整句话**留在细节里当证人（上一行已经逐字比过整句，这里比的是"打头"那一段）。
    ck('#pill-state 的措辞确实是"已定 0/边数"打头', text(A0.dom.pillState).startsWith(`已定 0/${f.edges}`),
      `整句="${text(A0.dom.pillState)}" 没有以「已定 0/${f.edges}」打头`);
    ck('状态行说的数与 state() 一致', lineHas(text(A0.dom.status), `还有 ${s.unknown} 条边没定`, `已定 ${s.decided}/${s.edges}`, `${s.regions} 块`, `${s.markers} 个`), text(A0.dom.status));

    // 几何：画布盒子必须等于渲染层自己算的那套数（不许被 CSS 压）
    const gg = geo();
    const cr = canvasRect();
    eq('dpr 至少 1', gg.dpr >= 1, true);
    eq('画布 CSS 宽 = geo.w（没被压）', Math.round(cr.width * 100) / 100, gg.w);
    eq('画布 CSS 高 = geo.h（没被压）', Math.round(cr.height * 100) / 100, gg.h);
    eq('位图后备 = geo.w × dpr', A0.dom.canvas.width, gg.w * gg.dpr);
    const B = await mod('js/render/board.js');
    ck(`格子边长落在 board.js 给的区间 [${B.Cell.min}, ${B.Cell.max}] 内`, gg.cell >= B.Cell.min && gg.cell <= B.Cell.max, `cell=${gg.cell}`);
    ck('#board 上没有 max-width（画布不许被等比压进容器）', getComputedStyle(A0.dom.canvas).maxWidth === 'none' && getComputedStyle(A0.dom.canvas).flexShrink === '0',
      `max-width=${getComputedStyle(A0.dom.canvas).maxWidth} shrink=${getComputedStyle(A0.dom.canvas).flexShrink}`);
    eq('#board-frame 横向自己滚', getComputedStyle(A0.dom.frame).overflowX, 'auto');

    // 像素：颜色只有 css/game.css 一份来源
    const P = {
      surface: rgbOf(varOf('surface')), unknown: rgbOf(varOf('unknown')), wall: rgbOf(varOf('wall')),
      ink: rgbOf(varOf('ink')), accentEdge: rgbOf(varOf('accent-edge')), hint: rgbOf(varOf('hint')),
      success: rgbOf(varOf('success')),
    };
    ck(`调色板从 CSS 变量读到（surface=${hexOf(P.surface)} unknown=${hexOf(P.unknown)}）`, Object.values(P).every((v) => Array.isArray(v) && v.length === 3), JSON.stringify(P));
    eq('空盘底色是 --surface（不是画黑的）', hexOf(px(gg.x + gg.cell / 2, gg.y + gg.cell / 2)), hexOf(P.surface));
    let markerMiss = [];
    g.markers.forEach((m, mi) => {
      const c = cellCentrePx(m.r * gg.gw + m.c);
      if (!same3(c, P.ink)) markerMiss.push(`${mi}@(${m.r},${m.c})=${hexOf(c)}`);
    });
    ck(`${g.markers.length} 枚记号都按 --ink 画在格心`, markerMiss.length === 0, markerMiss.join(' '));
    let noInk = [];
    let noDash = [];
    for (const e of g.edges) {
      const v = g.valueAt(e.i, e.dir);
      if (v !== G.UNKNOWN) noInk.push(`${e.i}/${e.dir}=${v}`);
      if (same3(pxAtRatio(e.i, e.dir), P.accentEdge)) noInk.push(`墙墨@${e.i}/${e.dir}`);
      // 虚线的货币是「墨与底各半」的混色，不是 --unknown 本身：1px 的线落在整数坐标上时
      // 抗锯齿把它正好劈成相邻两列（横线是两行）各 50%。实测（_tmp-tati-probe-px.js，cell=76、
      // dpr=1、未定边 0/1 的线在 x=92）：x=91 那列 = #c7d1dd = halfMix(#8fa3bb, 白底)，
      // x=92 那列 = #c3c4d0 = halfMix(#8fa3bb, 右格 tint #f6e5e5)。旧写法拿**精确色**去比
      // 一条半覆盖的线（`dashes.some((d) => same3(d, P.unknown))`），那是一件物理上不可能发生的事，
      // 于是画与没画都读不出 --unknown，24 条边全红——断言自己坏，不是盘子坏。
      // 采样点没挪：lineSamples 取的就是那条线**自己**那一列/一行，底往正方向挪 2px 现读
      // （口径与 lineSamples 头上那段实测一致），只是比较对象换成物理上真会出现的那一个。
      // 并且要求同一条线上**既有墨也有空**：只有虚线两头都有；实线（全墨）与根本没画（全底）都过不了。
      const onLine = lineSamples(e.i, e.dir).map((sp) => {
        const got = px(sp.x, sp.y);
        const bg = px(sp.bgX, sp.bgY);
        return { ink: same3(got, halfMix(P.unknown, bg)), bare: same3(got, bg) };
      });
      const inkN = onLine.filter((s) => s.ink).length;
      const gapN = onLine.filter((s) => s.bare).length;
      if (inkN === 0 || gapN === 0) noDash.push(`${e.i}/${e.dir} 墨${inkN}/空${gapN}`);
    }
    ck(`空盘上 ${g.edges.length} 条内部边全是未定（既没有值也没有墙墨）`, noInk.length === 0, noInk.join(' '));
    ck(`每条未定边都画了 --unknown 的虚线（虚线总有采样点落在墨上）`, noDash.length === 0, `没有虚线的边：${noDash.join(' ')}`);
    let borderBad = [];
    // 标签说的是**外框四条线**：board.js 那一笔是 strokeRect(geo.x, geo.y, cell*gw, cell*gh)，
    // lineWidth = max(2.5, cell*0.09) ≈ 6.84，正中那一列/行是 100% 覆盖（实测 x=13..18、y=13..18
    // 逐位等于 --wall #101922）。旧写法遍历的却是 c=0..gw 的**竖线**：4×4 的盘上那是 5 条竖线，
    // 只有 c=0 与 c=gw 是框，中间三条正是上一条断言要求画 --unknown 虚线的内部边（两条断言互相
    // 否定，读数 #f6e5e5/#ffffff/#f6f2e5 就是那几条线上的底），而上下两条框线它一个像素都没采。
    // 现在按标签各取四条框线，沿边逐格取中点（离两端圆角都远），读数仍是画布像素。
    const frameMid = Math.floor(gg.cell / 2);
    for (let k = 0; k < gg.gw; k++) {
      const x = gg.x + k * gg.cell + frameMid;
      borderBad = borderBad.concat(
        [[`上#${k}`, x, gg.y], [`下#${k}`, x, gg.y + gg.gh * gg.cell]]
          .filter(([, sx, sy]) => !same3(px(sx, sy), P.wall))
          .map(([tag, sx, sy]) => `${tag} x=${sx} y=${sy} ${hexOf(px(sx, sy))}`));
    }
    for (let k = 0; k < gg.gh; k++) {
      const y = gg.y + k * gg.cell + frameMid;
      borderBad = borderBad.concat(
        [[`左#${k}`, gg.x, y], [`右#${k}`, gg.x + gg.gw * gg.cell, y]]
          .filter(([, sx, sy]) => !same3(px(sx, sy), P.wall))
          .map(([tag, sx, sy]) => `${tag} x=${sx} y=${sy} ${hexOf(px(sx, sy))}`));
    }
    ck('外框四条线按 --wall 画（盘外就是边界墙）', borderBad.length === 0, borderBad.join(' '));

    // 命中：每条内部边两侧取样点都折到同一条规范边
    let hitBad = [];
    for (const e of g.edges) {
      const [p, q] = hitPts(e.i, e.dir);
      const hp = A0.hitAt(p.x, p.y);
      const hq = A0.hitAt(q.x, q.y);
      const want = slotKey(e.i, e.dir);
      if (!hp || !hq || slotKey(hp.i, hp.dir) !== want || slotKey(hq.i, hq.dir) !== want) {
        hitBad.push(`${e.i}/${e.dir}→${hp ? `${hp.i}/${hp.dir}` : 'null'},${hq ? `${hq.i}/${hq.dir}` : 'null'}`);
      }
    }
    ck(`${g.edges.length} 条内部边的命中盒两侧都解到同一条边`, hitBad.length === 0, hitBad.join(' '));
    const outside = A0.hitAt(cr.left - 8, cr.top + cr.height / 2);
    ck('盘外的点不落在任何条边上', outside === null, JSON.stringify(outside));
    return report({ seed: f.seed, genMs, cell: gg.cell, dpr: gg.dpr, checks: rows.length });
  };

  // ================================================================ play：真指针的一局
  const play = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const sc = scriptOf(f);
    const g = await openUntil('scn|newbie|0');
    const extra = {};
    eq('开局空盘', S().decided, 0);

    // 1) 点第一条事实：两侧取样必须折到同一条边
    const k0 = slotKey(sc[0].i, sc[0].dir);
    const pts = hitPts(sc[0].i, sc[0].dir);
    ck('命中点与格子无关（两侧同一个规范槽位）', slotKey(A().hitAt(pts[0].x, pts[0].y).i, A().hitAt(pts[0].x, pts[0].y).dir) === k0 && slotKey(A().hitAt(pts[1].x, pts[1].y).i, A().hitAt(pts[1].x, pts[1].y).dir) === k0,
      `${k0} vs ${JSON.stringify(A().hitAt(pts[0].x, pts[0].y))}/${JSON.stringify(A().hitAt(pts[1].x, pts[1].y))}`);
    await clickBtn(toolBtnFor(sc[0].want));
    eq('工具按钮点下去就是那把工具', S().mode, sc[0].want);
    await pointerTap(sc[0].i, sc[0].dir);
    eq('一笔落下：那条边写成了序列要的值', g.valueAt(sc[0].i, sc[0].dir), sc[0].want);
    eq('一笔 = 一步', S().moves, 1);
    eq('已定 +1', S().decided, 1);
    eq('#hud-moves 跟着走', text(A().dom.moves), 1);
    eq('#hud-unknown 跟着减', text(A().dom.unknown), f.edges - 1);
    eq('墙计数', S().walls, sc[0].want === 1 ? 1 : 0);
    eq('说不通计数仍为 0（画的是序列上的真话）', S().clashes, 0);
    ck('状态行报的数与 state() 一致', lineHas(text(A().dom.status), `还有 ${f.edges - 1} 条边没定`, `已定 1/${f.edges}`), text(A().dom.status));
    eq('状态行没有红/绿配色（正常落笔）', A().dom.status.className, '');
    eq('#pill-state 跟着走', text(A().dom.pillState), pillWant(S()));
    // 同 :507 那一处坏形状（布尔 vs 整句），这里也改成 ck + 整句当证人。
    ck('#pill-state 那一句写着已定 1/N', text(A().dom.pillState).startsWith(`已定 1/${f.edges}`),
      `整句="${text(A().dom.pillState)}" 没有以「已定 1/${f.edges}」打头`);
    extra.wallPixel = hexOf(pxAtRatio(sc[0].i, sc[0].dir));
    eq('墙按 --accent-edge 画在条线中点', extra.wallPixel, hexOf(rgbOf(varOf('accent-edge'))));
    eq('抬手后预览收回', hiddenTight('#board-preview'), true);

    // 2) 同一条边再点一次 = 擦掉（三种工具同式）
    await pointerTap(sc[0].i, sc[0].dir);
    eq('同工具再点自己：那条边回到未定', g.valueAt(sc[0].i, sc[0].dir), G.UNKNOWN);
    eq('这也是一步（擦也是落笔）', S().moves, 2);
    eq('已定回到 0', S().decided, 0);
    await pointerTap(sc[0].i, sc[0].dir);
    eq('再点回来', g.valueAt(sc[0].i, sc[0].dir), sc[0].want);
    eq('步数 3', S().moves, 3);

    // 3) 打通：块少一块
    const sm = sc.find((x) => x.want === 2);
    await clickBtn('#tool-same');
    eq('#tool-same 按下', $('#tool-same').getAttribute('aria-pressed'), 'true');
    eq('#tool-wall 松开', $('#tool-wall').getAttribute('aria-pressed'), 'false');
    const regionsBefore = S().regions;
    await pointerTap(sm.i, sm.dir);
    eq('那条边是"同块"', g.valueAt(sm.i, sm.dir), 2);
    eq('#hud-merged 记一笔', text(A().dom.merged), 1);
    eq('打通让块数减 1', S().regions, regionsBefore - 1);
    eq('#hud-blocks 与 state() 对上', text(A().dom.blocks), `${S().regions}/${S().markers}`);
    const mergedPx = hexOf(pxAtRatio(sm.i, sm.dir));
    ck('同块那条线上没有墙墨（块自然连成一片）', mergedPx !== hexOf(rgbOf(varOf('accent-edge'))), mergedPx);
    extra.mergedPixel = mergedPx;

    // 4) 一笔拖过多条边 = 一次落笔、一条撤销
    // 这一对必须**现挑**：一笔只写一个值，起笔那条边的现值决定这一笔是"写"还是"擦"
    // （js/ui/game.js::stroke 的口径 + js/main.js 的 segValue：cur === mode 就整条擦回未定）。
    // 旧写法写死 row=2 → 8/1 与 9/1，而 8/1 就是本场景第 1~3 步反复点的那条边（sc[0]），
    // 拖之前它已经是墙了，于是这一笔被产品正确地当成"擦"：实测 decided 2→1、writes 只有 1 条，
    // 接着第二段拖（本来要测"从已有墙起笔整条擦回未定"）反而成了写。两条断言测的是两件事，
    // 却不能共用同一对边；期望值（+2、writes=2、整条擦回未定）一条都不改，改的是这里挑的边。
    const dragPick = (() => {
      for (const e of g.edges) {
        if (g.valueAt(e.i, e.dir) !== G.UNKNOWN) continue;
        const j = e.i + 1;
        if (j % f.w === 0 || j >= f.w * f.h) continue;
        if (g.valueAt(j, e.dir) !== G.UNKNOWN) continue;
        const a = sc.find((x) => x.i === e.i && x.dir === e.dir);
        const b = sc.find((x) => x.i === j && x.dir === e.dir);
        if (a && b && a.want === b.want) return [{ i: e.i, dir: e.dir }, { i: j, dir: e.dir }];
      }
      return [];
    })();
    ck('盘上存在两条同值、相邻、都还没定的边给这一笔拖', dragPick.length === 2, `挑到 ${dragPick.map((e) => `${e.i}/${e.dir}`).join(',')}`);
    const dragSegs = dragPick;
    const dragWant = dragSegs.map((e) => sc.find((x) => x.i === e.i && x.dir === e.dir)).filter(Boolean);
    ck(`拖的那两条边（${dragSegs.map((e) => `${e.i}/${e.dir}`).join(', ')}）都在序列上`, dragWant.length === dragSegs.length, dragWant.map((x) => x && `${x.i}/${x.dir}`).join(','));
    const sameTool = dragWant.every((x) => x.want === dragWant[0].want);
    ck('拖的这两条边要同一个值（一笔只写一个值）', sameTool, dragWant.map((x) => `${x.i}/${x.dir}=${x.want}`).join(' '));
    await clickBtn(toolBtnFor(dragWant[0].want));
    const movesBeforeDrag = S().moves;
    const decidedBeforeDrag = S().decided;
    PID++;
    const dpts = dragSegs.map((e) => hitPts(e.i, e.dir)[0]);
    ptr('pointerdown', dpts[0]);
    const pv = { hidden: A().dom.preview.hidden, left: A().dom.preview.style.left, top: A().dom.preview.style.top };
    const hintRgb = hexOf(rgbOf(varOf('hint')));
    const inkDuring = alongEdge(dragSegs[0].i, dragSegs[0].dir, 12).map((p) => px(p.x, p.y)).some((d) => hexOf(d) === hintRgb);
    ck('按住拖动期间预览浮层出现且写着"格 侧 → 值"', !pv.hidden && /→/.test(text(A().dom.preview)) && /^-?\d+(\.\d+)?px$/.test(pv.left) && /^-?\d+(\.\d+)?px$/.test(pv.top),
      `hidden=${pv.hidden} text="${text(A().dom.preview)}" left=${pv.left} top=${pv.top}`);
    ck('拖动中的边按 --hint 虚线画在画布上（预览是油漆）', inkDuring, `沿 ${dragSegs[0].i}/${dragSegs[0].dir} 取样里没有 ${hintRgb}`);
    ptr('pointermove', dpts[1]);
    ptr('pointerup', dpts[1]);
    await wait(10);
    eq('一笔拖 = 一步', S().moves, movesBeforeDrag + 1);
    eq('一笔拖把扫过的两条边都写了', S().decided, decidedBeforeDrag + 2);
    eq('两条边都在最后一步里', g.steps[g.steps.length - 1].writes.length, 2);
    eq('那一步的类型', g.steps[g.steps.length - 1].kind, 'stroke');
    eq('拖完预览收起来', hiddenTight('#board-preview'), true);
    // 从自己已画的线上起笔 = 擦掉这一笔
    PID++;
    ptr('pointerdown', hitPts(dragSegs[0].i, dragSegs[0].dir)[0]);
    ptr('pointermove', hitPts(dragSegs[1].i, dragSegs[1].dir)[0]);
    ptr('pointerup', hitPts(dragSegs[1].i, dragSegs[1].dir)[0]);
    await wait(10);
    eq('从已有墙起笔的同一把工具：整条擦回未定', g.valueAt(dragSegs[0].i, dragSegs[0].dir), G.UNKNOWN);
    eq('另一条也擦了', g.valueAt(dragSegs[1].i, dragSegs[1].dir), G.UNKNOWN);
    eq('擦也算一步', S().moves, movesBeforeDrag + 2);

    // 5) 键盘换工具、擦掉工具
    const keyd = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    keyd('3');
    await wait(10);
    eq("键盘 '3' → 擦掉工具", S().mode, G.UNKNOWN);
    eq('#tool-erase 按下', $('#tool-erase').getAttribute('aria-pressed'), 'true');
    // 「擦掉也算落笔」说的是**增量**：这一下必须正好多一步。旧写法写死 `moves === 5`，
    // 而它上面三行刚刚断言过"擦那一笔也算一步"= movesBeforeDrag+2（= 6，绿的），
    // 两条字面量互相矛盾 —— 那个 5 是这一段插进拖把断言之前的旧算式，不是引擎该给的数。
    const movesBeforeErase = S().moves;
    await pointerTap(sc[0].i, sc[0].dir);
    eq('擦掉工具点已有墙：回到未定', g.valueAt(sc[0].i, sc[0].dir), G.UNKNOWN);
    eq('擦掉也算落笔（正好多一步）', S().moves, movesBeforeErase + 1);
    const movesAfterErase = S().moves;
    keyd('m');
    await wait(10);
    eq("键盘 'm' 循环到画墙", S().mode, G.WALL);

    // 6) 盘外不写、无解处不写
    const cr = canvasRect();
    PID++;
    ptr('pointerdown', { x: cr.left + cr.width / 2, y: cr.bottom + 40 });
    ptr('pointerup', { x: cr.left + cr.width / 2, y: cr.bottom + 40 });
    await wait(10);
    // 同上：盘外那一下的判据是"一步都不许多"，不是那个旧字面量 5。
    eq('盘外的一点不产生任何一步', S().moves, movesAfterErase);
    eq('也没写出任何边', S().decided, S().decided && g.edges.length - g.unknown);
    ck('一整局玩下来都没有说不通', S().clashes === 0, `clashes=${S().clashes}`);
    eq('提示一次都没用', S().hints, 0);
    return report({ moves: S().moves, decided: S().decided, ...extra });
  };

  // ================================================================ undo
  const undoScn = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const sc = scriptOf(f);
    const g = await openUntil('scn|newbie|0');
    const free = freeOf(f);

    // 一笔三条边，撤销一次全回去
    const segs = [{ i: 8, dir: 1 }, { i: 9, dir: 1 }, { i: 10, dir: 1 }];
    await clickBtn('#tool-wall');
    PID++;
    const pts = segs.map((e) => hitPts(e.i, e.dir)[0]);
    ptr('pointerdown', pts[0]);
    ptr('pointermove', pts[1]);
    ptr('pointermove', pts[2]);
    ptr('pointerup', pts[2]);
    await wait(10);
    eq('一笔写了三条边', g.steps[g.steps.length - 1].writes.length, 3);
    eq('步数 1', S().moves, 1);
    eq('已定 3', S().decided, 3);
    const step1 = A().undo();
    await wait(10);
    eq('撤销交回那一步', step1 && step1.kind, 'stroke');
    eq('撤销交回三条边', step1 && step1.writes.length, 3);
    segs.forEach((e, k) => eq(`第 ${k} 条回到未定`, g.valueAt(e.i, e.dir), G.UNKNOWN));
    eq('撤销后已定归零', S().decided, 0);
    eq('撤销后步数归零', S().moves, 0);
    eq('撤销后栈空', g.steps.length, 0);
    eq('#hud-moves 归零', text(A().dom.moves), 0);
    ck('撤销那句写着"一次落笔"与条数', lineHas(text(A().dom.status), `撤销了 3 条边`, '一次落笔', '提示次数不退还'), text(A().dom.status));
    ck('没有东西可撤时响亮说话、不改盘面', A().undo() === null && lineHas(text(A().dom.status), '没有可撤销的一笔了'), text(A().dom.status));
    eq('空撤销不改步数', S().moves, 0);

    // 补一眼墙：只写空盘 R1 那一特例，然后能撤回去
    const pr = A().prune();
    await wait(10);
    eq('补墙落了一步', pr && pr.kind, 'prune');
    eq('补的条数 = 空盘上 R1 给的墙条数', g.steps[g.steps.length - 1].writes.length, free.length);
    eq('补墙不算玩家的手（moves 不涨）', S().moves, 0);
    eq('prunes 计一次', S().prunes, 1);
    eq('提示没被动', S().hints, 0);
    eq('#hud-walls 跟着涨', text(A().dom.walls), free.length);
    ck('补墙那句写出条数与理由', lineHas(text(A().dom.status), `补了 ${free.length} 条墙`), text(A().dom.status));
    ck('再补一次没有新东西（并说明为什么）', A().prune() === null && lineHas(text(A().dom.status), '已经补过'), text(A().dom.status));
    const undoPrune = A().undo();
    await wait(10);
    eq('补墙能撤', undoPrune && undoPrune.kind, 'prune');
    eq('撤完 prunes 回到 0', S().prunes, 0);
    eq('撤完墙没了', S().walls, 0);

    // 提示可以撤，但次数不退还
    const h1 = A().useHint();
    await wait(10);
    eq('提示落了一步', h1 && h1.charged, true);
    eq('用掉一次提示', S().hints, 1);
    const und = A().undo();
    await wait(10);
    eq('撤的是那一条提示', und && und.kind, 'hint');
    eq('撤回去那条边回到未定', g.valueAt(h1.i, h1.dir), G.UNKNOWN);
    eq('提示次数不退还', S().hints, 1);
    ck('撤销那句说的是"那是一条提示"', lineHas(text(A().dom.status), '那是一条提示', '提示次数不退还'), text(A().dom.status));

    // 这一条是本档那句"零猜测"的正面说法：撤掉一条求助之后，提示这条路仍然必须能走完这盘。
    // js/ui/game.js::undo() 只还原边、不回退 script 游标，于是被撤的那条永远再也提不到 ——
    // 这里不放过它，红就红。node 侧同一个夹具重算给出的证人写在 fixture 的 undoCursorProbe。
    const walk = A().solveWithLogic();
    await wait(20);
    eq(`撤一条提示之后序列仍能推到底（node 证人：${f.undoCursorProbe}）`, walk.status, 'won');
    eq('序列走完时不该还有未定的边', S().unknown, 0);
    eq('走完时 #hint-left 应当与未定边一起归零', text(A().dom.hintLeft), `剩 ${S().unknown && f.scriptLen - S().cursor}`);
    return report({ prunes: S().prunes, hints: S().hints, unknown: S().unknown, status: S().status });
  };

  // ================================================================ hint
  const hint = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const sc = scriptOf(f);
    const g = await openUntil('scn|newbie|0');
    const hintRgb = hexOf(rgbOf(varOf('hint')));
    const edgeRgb = hexOf(rgbOf(varOf('accent-edge')));
    eq('序列长度 = 内部边数（每条边恰好出一次处）', g.script.length, f.edges);
    eq('序列与 node 重算的那一条逐字一致', g.script.map((x) => `${x.rule}|${x.i}|${x.dir}|${x.want}`).join('; '), f.script);
    let bad = [];
    let leftWrong = [];
    let pulseBad = [];
    let lineBad = [];
    for (let k = 0; k < sc.length; k++) {
      const before = S().decided;
      const h = A().useHint();
      await wait(8);
      if (!h || h.charged !== true || h.i !== sc[k].i || h.dir !== sc[k].dir || h.value !== sc[k].want) {
        bad.push(`#${k} got ${JSON.stringify(h)} want ${sc[k].rule}|${sc[k].i}|${sc[k].dir}|${sc[k].want}`);
        break;
      }
      if (S().hints !== k + 1) bad.push(`#${k} hints=${S().hints}`);
      if (S().decided !== before + 1) bad.push(`#${k} decided ${before}→${S().decided}`);
      if (text(A().dom.hintLeft) !== `剩 ${sc.length - k - 1}`) leftWrong.push(`#${k} "${text(A().dom.hintLeft)}"`);
      if (hexOf(pxAtRatio(h.i, h.dir)) !== hintRgb) pulseBad.push(`#${k} ${h.i}/${h.dir} 中点=${hexOf(pxAtRatio(h.i, h.dir))}`);
      const want = `${sc[k].rule}｜${G.edgeName(g.w, h.i, h.dir)} 必须是「${G.valName(h.value)}」`;
      const line = text(A().dom.status);
      if (S().status === 'won') {
        // 最后那一下把盘铺完了：状态行按产品的口径换成引擎那句"合法"
        // （js/main.js::useHint 里明写"这一下把盘铺完了就别拿提示的句子盖掉赢的话"，
        // 而 win 场景 tools/scenarios.js:979 那条绿的断言又逐字钉着那句里必须有
        // invalidReason/长方形/记号）。旧写法拿提示句去比这一步：那一步不可能既是赢又被写成
        // 提示句 —— 期望与另一条已绿的断言互相否定，属于断言形状坏，不是产品缺陷。
        // 证人换成同一句引擎的话的三块料，逐字性由 win 场景那边守着，这里不抄第二份整句。
        if (!(line.includes('长方形') && line.includes('记号') && line.includes('invalidReason'))) lineBad.push(`#${k} 赢的那句不是引擎的合法判定 "${line.slice(0, 60)}"`);
      } else if (!line.startsWith(want)) lineBad.push(`#${k} "${line.slice(0, 60)}"`);
      if (A().dom.status.className !== 'good') lineBad.push(`#${k} class=${A().dom.status.className}`);
    }
    ck(`${sc.length} 下提示逐条对上序列（值/次数/已定都跟着）`, bad.length === 0, bad.slice(0, 4).join(' | '));
    ck('#hint-left 每下减一', leftWrong.length === 0, leftWrong.slice(0, 4).join(' | '));
    ck('提示当下那一条边被 --hint 光带画住', pulseBad.length === 0, pulseBad.slice(0, 4).join(' | ') + ` 期望 ${hintRgb}`);
    ck('状态行逐字由引擎的话拼出（规则｜边名 必须是「值」——理由）', lineBad.length === 0, lineBad.slice(0, 3).join(' | '));
    const control = hexOf(pxAtRatio(sc[0].i, sc[0].dir));
    ck('走完之后再取同一条边的中点已经不是光带（光带会自己消失或变成墙墨）', control === edgeRgb || control !== hintRgb, control);
    eq('提示把盘推到底', S().status, 'won');
    eq('用的提示次数 = 序列长度', S().hints, sc.length);
    eq('#hint-left 归零', text(A().dom.hintLeft), '剩 0');
    eq('#hud-hints 与 state() 对上', text(A().dom.hints), sc.length);
    eq('未定为 0', S().unknown, 0);
    eq('块数 = 记号数', `${S().regions}/${S().markers}`, `${f.markers.split(' ').length}/${f.markers.split(' ').length}`);
    ck('赢的遮罩挂着', shown('#win-veil') && A().dom.veil.hidden === false, `display=${getComputedStyle(A().dom.veil).display} rects=${A().dom.veil.getClientRects().length}`);
    ck('遮罩里没有"说不通"的字', !text(A().dom.veil).includes('说不通'), text(A().dom.veil).slice(0, 120));
    await wait(1700);
    const afterPulse = hexOf(pxAtRatio(sc[1].i, sc[1].dir));
    ck('光带过期后那条边只剩墙墨或绿墨（画布不留 --hint）', afterPulse !== hintRgb, afterPulse);
    eq('赢了之后再按提示不干活', A().useHint(), null);
    return report({ hints: S().hints, script: sc.length, control, afterPulse });
  };

  // ================================================================ clash
  const clash = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const sc = scriptOf(f);
    const g = await openUntil('scn|newbie|0');
    // 故意把序列第一条反着画：墙 ↔ 打通
    const wrong = sc[0].want === 1 ? 2 : 1;
    await clickBtn(toolBtnFor(wrong));
    await pointerTap(sc[0].i, sc[0].dir);
    eq('反着那一笔确实落了', g.valueAt(sc[0].i, sc[0].dir), wrong);
    eq('步数 1', S().moves, 1);
    ck('引擎在玩家自己的线上推出矛盾（条数 > 0）', S().clashes > 0, `clashes=${S().clashes} contradictions=${JSON.stringify(g.contradictions.slice(0, 2))}`);
    eq('#hud-clash 写出条数', text(A().dom.clash), S().clashes);
    eq('药丸进入"说不通"配色', A().dom.pillState.classList.contains('bad'), true);
    ck('药丸那句标明尚未合法', text(A().dom.pillState).includes('尚未合法'), text(A().dom.pillState));
    ck('状态行说这一笔被当场证伪并点了规则名', lineHas(text(A().dom.status), '被铅笔通道当场证伪', g.contradictions[0].rule, '先撤销那一笔'), text(A().dom.status));
    eq('状态行配色是 bad', A().dom.status.className, 'bad');
    const before = S().hints;
    const h = A().useHint();
    await wait(10);
    ck('矛盾当前提示只说话不下笔', h && h.charged === false && !!h.conflict, JSON.stringify(h));
    eq('不扣次数', S().hints, before);
    eq('#hud-hints 也没动', text(A().dom.hints), before);
    ck('那句话写着"提示没有扣次数"', String(h.conflict).includes('提示没有扣次数'), String(h.conflict));
    ck('矛盾那一条被光带指出来', hexOf(pxAtRatio(h.i, h.dir)) === hexOf(rgbOf(varOf('hint'))), `${h.i}/${h.dir} ${hexOf(pxAtRatio(h.i, h.dir))}`);
    eq('盘面没被提示改动', g.valueAt(sc[0].i, sc[0].dir), wrong);
    const hintRgb = hexOf(rgbOf(varOf('hint')));
    const control = g.edges.find((e) => !(e.i === h.i && e.dir === h.dir));
    ck('没被指名的那条边不是光带色（对照）', hexOf(pxAtRatio(control.i, control.dir)) !== hintRgb, hexOf(pxAtRatio(control.i, control.dir)));
    // 撤掉那一笔，矛盾就化开，提示回到"能下笔"
    const u = A().undo();
    await wait(10);
    eq('撤的是那一笔', u && u.kind, 'tap');
    eq('撤完矛盾没了', S().clashes, 0);
    eq('药丸退出 bad 配色', A().dom.pillState.classList.contains('bad'), false);
    const h2 = A().useHint();
    await wait(10);
    eq('提示重新能下笔并扣次数', h2 && h2.charged, true);
    eq('次数 +1', S().hints, before + 1);
    eq('它说的就是序列第一条', `${h2.i}/${h2.dir}`, `${sc[0].i}/${sc[0].dir}`);
    return report({ clashes: S().clashes, hints: S().hints, rule: g.contradictions.length ? g.contradictions[0].rule : 'none' });
  };

  // ================================================================ win
  const win = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const sc = scriptOf(f);
    const g = await openUntil('scn|newbie|0');
    // 全程真指针：按序列逐条把 24 条边点满，一次都不碰 solveWithLogic/revealAll
    const seenRules = {};
    let modeNow = null;
    let tapBad = [];
    for (let k = 0; k < sc.length; k++) {
      if (sc[k].want !== modeNow) {
        await clickBtn(toolBtnFor(sc[k].want));
        modeNow = sc[k].want;
      }
      await pointerTap(sc[k].i, sc[k].dir);
      seenRules[sc[k].rule] = (seenRules[sc[k].rule] || 0) + 1;
      if (g.valueAt(sc[k].i, sc[k].dir) !== sc[k].want) tapBad.push(`#${k} ${sc[k].i}/${sc[k].dir}=${g.valueAt(sc[k].i, sc[k].dir)}`);
      if (S().decided !== k + 1) tapBad.push(`#${k} decided=${S().decided}`);
      if (S().status === 'won' && k !== sc.length - 1) tapBad.push(`#${k} 提前赢了`);
    }
    ck(`${sc.length} 下指针落笔把每条边都写成序列要的值`, tapBad.length === 0, tapBad.slice(0, 5).join(' | '));
    eq('没调用任何 API 也赢了（纯手势到赢）', S().status, 'won');
    eq('步数 = 手势数', S().moves, sc.length);
    eq('一次提示都没用', S().hints, 0);
    eq('未定为 0', S().unknown, 0);
    eq('墙数与序列对得上', S().walls, f.wallsWant);
    eq('同块数与序列对得上', S().merged, f.mergedWant);
    eq('块数 = 记号数', S().regions, f.markers.split(' ').length);
    eq('合法谓词点头', S().illegal, null);
    eq('每块都是长方形', S().rectOk, true);
    eq('说不通为 0', S().clashes, 0);
    ck('遮罩显示（display 不是 none 且有矩形）', shown('#win-veil') && A().dom.veil.hidden === false,
      `display=${getComputedStyle(A().dom.veil).display} rects=${A().dom.veil.getClientRects().length} hidden=${A().dom.veil.hidden}`);
    eq('#win-hints', text(A().dom.winHints), 0);
    eq('#win-moves', text(A().dom.winMoves), sc.length);
    ck('#win-time 是 mm:ss', /^\d{2}:\d{2}$/.test(text(A().dom.winTime)), text(A().dom.winTime));
    ck('#win-proof-line 写着浏览器里重数的唯一性', lineHas(text(A().dom.winProof), `${f.sols} 个解`, `${f.nodes} 个节点`, 'countAnchored', `难度分 ${f.score}`, `铅笔序列 ${f.scriptLen} 条`, `${f.passes} 轮`), text(A().dom.winProof));
    ck('#win-proof-line 的毫秒数是读出来的非负数', /0\.\d{2} ms|^\D*\d+(\.\d+)? ms/.test(text(A().dom.winProof).replace(/.*?(\d+(\.\d+)?) ms/, '$1 ms')), text(A().dom.winProof));
    eq('#win-record-line 第一次赢就是新纪录', text(A().dom.winRecord), '本档新纪录。');
    ck('#win-note 说两条通道逐边一致', (() => { const st = S(); return st.agree === true && lineHas(text(A().dom.winNote), '两条通道', '逐条边一致'); })(), text(A().dom.winNote));
    eq('#pill-state 换成赢的那句', text(A().dom.pillState), '已铺开');
    eq('药丸带 win 配色', A().dom.pillState.classList.contains('win'), true);
    ck('状态行与遮罩说同一句话（都是引擎那句合法）', (() => { const s = text(A().dom.status); return s.includes('invalidReason') && s.includes('长方形') && s.includes('记号'); })(), text(A().dom.status));
    eq('状态行配色 good', A().dom.status.className, 'good');
    eq('#hint-left 一次没用过', text(A().dom.hintLeft), `剩 ${f.scriptLen}`);
    // 赢了之后墙线改画 --success，并且不再有未定的虚线
    const succ = hexOf(rgbOf(varOf('success')));
    let wrongColour = [];
    for (const e of g.edges) {
      const v = g.valueAt(e.i, e.dir);
      const got = hexOf(pxAtRatio(e.i, e.dir));
      if (v === 1 && got !== succ) wrongColour.push(`${e.i}/${e.dir}=${got} want ${succ}`);
      if (v === 0) wrongColour.push(`${e.i}/${e.dir} 还留着未定`);
    }
    ck(`整盘的墙都改成 --success（${succ}），没有一条留在未定`, wrongColour.length === 0, wrongColour.slice(0, 5).join(' | '));
    // 赢完冻盘：手势与每一个测试面入口都拒绝
    await pointerTap(sc[0].i, sc[0].dir);
    eq('赢后的一下不改盘面', g.valueAt(sc[0].i, sc[0].dir), sc[0].want);
    eq('赢后的手势不涨步数', S().moves, sc.length);
    eq('赢后 tap 拒绝', A().tap(sc[0].i, sc[0].dir, 2), null);
    eq('赢后 stroke 拒绝', A().stroke([{ i: sc[0].i, dir: sc[0].dir }], 2), null);
    eq('赢后 hint 拒绝', A().useHint(), null);
    eq('赢后 prune 拒绝', A().prune(), null);
    eq('赢后 undo 拒绝（遮罩不许跟盘面分家）', A().undo(), null);
    eq('拒绝撤销时盘仍然是赢的', S().status, 'won');
    eq('拒绝 revealAll（它能把已定的边再写一遍）', A().revealAll(), null);
    eq('盘还是满的', S().decided, f.edges);
    ck('遮罩还在', shown('#win-veil'), getComputedStyle(A().dom.veil).display);
    // 纪录与累计落进 localStorage，续档被清掉
    const Store = await mod('js/store.js');
    const raw = localStorage.getItem(Store.SAVE_KEY);
    ck('存档键写在这一盘赢之后', !!raw, `keys=${Object.keys(localStorage).join(',')}`);
    const d = JSON.parse(raw);
    eq('版本号 v', d.v, 1);
    eq('续档在赢的那一步被清掉', d.resume, null);
    eq('#hud-tier 那一档写进了 best', Object.keys(d.best).join(''), f.tier);
    eq('best.hints', d.best[f.tier].hints, 0);
    eq('best.moves', d.best[f.tier].moves, sc.length);
    eq('best.seed', d.best[f.tier].seed, f.seed);
    ck('best.ms 是个正整数毫秒', Number.isInteger(d.best[f.tier].ms) && d.best[f.tier].ms > 0, String(d.best[f.tier].ms));
    eq('累计：开局 1 盘', d.totals.played, 1);
    eq('累计：完成 1 盘', d.totals.won, 1);
    eq('累计：用过提示 0 次', d.totals.hints, 0);
    // 回选档：纪录表与累计行都读出来
    await clickBtn('#btn-menu-2');
    await wait(30);
    eq('回到选档页', A().view(), 'menu');
    ck('选档页的纪录行写着刚赢那一盘的 seed 与次数', (() => {
      const li = [...document.querySelectorAll('#best-list li')].filter((x) => x.textContent.includes(f.tierName))[0];
      const s = li ? li.textContent : '';
      return s.includes(f.seed) && s.includes('提示 0 次') && s.includes(`步数 ${sc.length}`) && !s.includes('还没有纪录');
    })(), [...document.querySelectorAll('#best-list li')].map((x) => x.textContent.trim()).join(' | ').slice(0, 400));
    eq('累计行读回 1 盘', text(A().dom.totalsLine), '累计：开局 1 盘 · 完成 1 盘 · 用过提示 0 次');
    ck('赢过之后不再给续档卡（续档已被清）', hiddenTight('#resume-card'), `display=${getComputedStyle(A().dom.resumeCard).display}`);
    return report({ moves: S().moves, rules: Object.keys(seenRules).length, ms: d.best[f.tier].ms, won: d.totals.won });
  };

  // ================================================================ save
  const save = async () => {
    await wipe();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const St = await mod('js/store.js');
    const g = await openUntil('scn|newbie|0');
    eq('开局就记了一笔 played', JSON.parse(localStorage.getItem(St.SAVE_KEY)).totals.played, 1);
    // 逐 token 执行夹具里那份手势表（node 侧用 Game 的 API 重放同一份，导出 ink）
    let modeNow = null;
    for (const tok of f.saveOps.split(' ')) {
      if (tok === 'h') { await clickBtn('#btn-hint'); continue; }
      if (tok.startsWith('t:')) {
        const [, i, dir, val] = tok.split(':');
        if (Number(val) !== modeNow) { await clickBtn(toolBtnFor(Number(val))); modeNow = Number(val); }
        await pointerTap(Number(i), Number(dir));
        continue;
      }
      if (tok.startsWith('d:')) {
        const [segList, val] = [tok.slice(2).split(':')[0], tok.slice(2).split(':')[1]];
        const segs = segList.split(',').map((s) => { const [i, dir] = s.split('/'); return { i: Number(i), dir: Number(dir) }; });
        if (Number(val) !== modeNow) { await clickBtn(toolBtnFor(Number(val))); modeNow = Number(val); }
        await pointerDrag(segs, false);
      }
    }
    eq('手势表跑出来的步数与 node 重放一致', S().moves, f.saveMoves);
    eq('提示次数一致', S().hints, f.saveHints);
    eq('已定条数一致', S().decided, f.saveDecided);
    eq('未定条数一致', S().unknown, f.saveUnknown);
    eq('墙数一致', S().walls, f.saveWalls);
    eq('同块数一致', S().merged, f.saveMerged);
    eq('块数一致', S().regions, f.saveRegions);
    eq('这一局画下来没有说不通', S().clashes, f.saveClashes);
    eq('还没赢', S().status, 'playing');
    const ok = A().flushResume();
    eq('flushResume 写进去了', ok, true);
    const raw = localStorage.getItem(St.SAVE_KEY);
    ck('localStorage 里有这一把键', !!raw, `keys=${Object.keys(localStorage).join(',')}`);
    const d = JSON.parse(raw);
    eq('v', d.v, 1);
    eq('续档的 seed', d.resume.seed, f.seed);
    eq('续档的档名', d.resume.tierKey, f.tier);
    eq('续档的宽高', `${d.resume.w}×${d.resume.h}`, `${f.w}×${f.h}`);
    // 续档里那两格存的是 **RLE 串**（js/store.js::rle：`0x8,1x3,0x5`），不是数组，
    // 所以旧写法 `d.resume.ink.right.length === w*h` 量的是**字符数**（实测 '0x8,1x3,0x5'.length=11
    // 对 16），拿一条边数组的长度去比一个串的宽度 —— 这条永远不可能过，也不是产品把边数写错了。
    // 按标签真正要断的事修形状：用 store 自己的 unrle 把它解回边数组（unrle 要求游程**刚好**铺满
    // n 格、值都在三态里，否则返回 null），解出来的长度必须等于 w×h，两条数组都算。
    const backRight = St.unrle(d.resume.ink.right, f.w * f.h);
    const backDown = St.unrle(d.resume.ink.down, f.w * f.h);
    ck('续档的边数与盘面一致（RLE 解回来必须正好铺满 w×h 条槽位）',
      !!backRight && backRight.length === f.w * f.h && !!backDown && backDown.length === f.w * f.h,
      `right="${d.resume.ink.right}"→${backRight ? backRight.length : 'null'} down="${d.resume.ink.down}"→${backDown ? backDown.length : 'null'}，盘上 ${f.w}×${f.h}=${f.w * f.h} 格`);
    eq('right 那条 RLE 与 node 重放一致', d.resume.ink.right, f.saveRleRight);
    eq('down 那条 RLE 与 node 重放一致', d.resume.ink.down, f.saveRleDown);
    eq('续档的步数', d.resume.moves, f.saveMoves);
    eq('续档的提示次数', d.resume.hints, f.saveHints);
    eq('续档不是日课', d.resume.daily, false);
    ck('续档记了 elapsedMs（正毫秒）', Number.isFinite(d.resume.elapsedMs) && d.resume.elapsedMs >= 0, String(d.resume.elapsedMs));
    ck('续档记了 savedAt', Number.isInteger(d.resume.savedAt) && d.resume.savedAt > 0, String(d.resume.savedAt));
    // 用 shipped 的解码器解回来，与玩家 ink 逐格对表（不是闸自己写的解码器）
    const right = St.unrle(d.resume.ink.right, f.w * f.h);
    const down = St.unrle(d.resume.ink.down, f.w * f.h);
    ck('unrle 能解回来（长度刚好铺满）', !!right && !!down && right.length === f.w * f.h, `${right && right.length}/${down && down.length}`);
    const ink = g.ink();
    let inkDiff = [];
    for (let i = 0; i < f.w * f.h; i++) {
      if (right[i] !== ink.right[i]) inkDiff.push(`right[${i}] ${right[i]}≠${ink.right[i]}`);
      if (down[i] !== ink.down[i]) inkDiff.push(`down[${i}] ${down[i]}≠${down[i] === ink.down[i] ? '' : ink.down[i]}`);
    }
    ck('解回来的那两条数组与画布上的 ink 逐格一致', inkDiff.length === 0, inkDiff.slice(0, 6).join(' | '));
    // 回选档：续档卡必须浮出来并写着这些数
    A().show('menu');
    await wait(40);
    ck('续档卡浮出来了', shown('#resume-card') && A().dom.resumeCard.hidden === false, `display=${getComputedStyle(A().dom.resumeCard).display}`);
    ck('续档摘要写着档名/尺寸/seed/步数/提示次数', (() => {
      const s = text(A().dom.resumeSummary);
      return lineHas(s, f.tierName, `${f.w}×${f.h}`, `seed ${f.seed}`, `已画 ${f.saveMoves} 步`, `用过 ${f.saveHints} 次提示`, '走了');
    })(), text(A().dom.resumeSummary));
    ck('对局页收起来、选档页可见', hiddenTight('#view-game') && shown('#view-menu'), `game=${getComputedStyle(A().dom.viewGame).display}`);
    return report({ moves: S().moves, hints: S().hints, rleRight: d.resume.ink.right, rleDown: d.resume.ink.down });
  };

  // ================================================================ resume（save 的配对：这是一次真刷新之后）
  const resume = async () => {
    const A0 = await booted();
    const f = bySeed('scn|newbie|0');
    const G = await mod('js/ui/game.js');
    const St = await mod('js/store.js');
    // 这一段不许 wipe()：它验的就是上一段场景写在磁盘上的东西。
    ck('页面刷新之后 window.tatamibari 仍然在', !!A0, 'nope');
    eq('刷新后落在选档页', A0.view(), 'menu');
    const raw = localStorage.getItem(St.SAVE_KEY);
    ck(`磁盘上还有那条存档（键 ${St.SAVE_KEY}）`, !!raw && JSON.parse(raw).resume !== null, String(raw).slice(0, 200));
    const d = JSON.parse(raw);
    eq('存的是夹具那一盘的 seed', d.resume.seed, f.seed);
    ck('续档卡浮出来（display 有、矩形有）', shown('#resume-card'), `display=${getComputedStyle(A0.dom.resumeCard).display} rects=${A0.dom.resumeCard.getClientRects().length}`);
    ck('摘要写着上一段留下的那些数', (() => { const s = text(A0.dom.resumeSummary); return lineHas(s, f.tierName, `seed ${f.seed}`, `已画 ${f.saveMoves} 步`, `用过 ${f.saveHints} 次提示`); })(), text(A0.dom.resumeSummary));
    ck('纪录表还是"还没有纪录"（上一段没赢过）', (() => { const li = [...document.querySelectorAll('#best-list li')].filter((x) => x.textContent.includes(f.tierName))[0]; return li && li.textContent.includes('还没有纪录'); })(), [...document.querySelectorAll('#best-list li')].map((x) => x.textContent.trim()).join(' | ').slice(0, 240));
    eq('累计还是上一段那一盘', text(A0.dom.totalsLine), '累计：开局 1 盘 · 完成 0 盘 · 用过提示 0 次');
    ck('续档卡上有两枚按钮（继续/丢弃）', shown('#btn-resume') && shown('#btn-discard'), `${getComputedStyle(A0.dom.btnResume).display}/${getComputedStyle(A0.dom.btnDiscard).display}`);
    await clickBtn('#btn-resume');
    for (let i = 0; i < 1200 && !A0.game; i++) await wait(25);
    await wait(40);
    const g = A0.game;
    ck('点"继续"之后真的上了台', !!g && A0.view() === 'game', `game=${!!g} view=${A0.view()}`);
    eq('回到的是同一个 seed 的同一盘', g.puzzle.seed, f.seed);
    eq('seed 也写进了 HUD', text(A0.dom.seed), f.seed);
    eq('步数照原样回来', S().moves, f.saveMoves);
    eq('提示次数照原样回来（撤销不退还）', S().hints, f.saveHints);
    eq('已定条数照原样回来', S().decided, f.saveDecided);
    eq('墙数', S().walls, f.saveWalls);
    eq('同块数', S().merged, f.saveMerged);
    eq('块数', S().regions, f.saveRegions);
    eq('说不通仍是 0', S().clashes, 0);
    eq('没被判成赢', S().status, 'playing');
    // ink 与磁盘上那两条 RLE 逐格对表（解码器是 js/store.js 那一套）
    const right = St.unrle(d.resume.ink.right, f.w * f.h);
    const down = St.unrle(d.resume.ink.down, f.w * f.h);
    const ink = g.ink();
    let diff = [];
    for (let i = 0; i < f.w * f.h; i++) {
      if (right[i] !== ink.right[i]) diff.push(`right[${i}] ${right[i]}≠${ink.right[i]}`);
      if (down[i] !== ink.down[i]) diff.push(`down[${i}] ${down[i]}≠${ink.down[i]}`);
    }
    ck('磁盘上的 ink 逐格回到了画布', diff.length === 0, diff.slice(0, 6).join(' | '));
    for (const e of g.edges) {
      const v = g.valueAt(e.i, e.dir);
      const got = hexOf(pxAtRatio(e.i, e.dir));
      if (v === 1 && got !== hexOf(rgbOf(varOf('accent-edge')))) diff.push(`墙墨 ${e.i}/${e.dir}=${got}`);
      break;
    }
    ck('恢复出来的墙在画布上是墙墨（不是内存里的残骸）', diff.length === 0, diff.slice(0, 3).join(' | '));
    ck('状态行说"存档已恢复"', lineHas(text(A0.dom.status), '存档已恢复', '提示与步数都照原样计'), text(A0.dom.status));
    eq('恢复之后撤销栈是空的（撤销不回滚到上一段之前）', g.steps.length, 0);
    ck('于是撤销会响亮说没有', A0.undo() === null && lineHas(text(A0.dom.status), '没有可撤销的一笔了'), text(A0.dom.status));
    // 再写一次续档：必须幂等（同两条 RLE），不能把盘面写歪
    A0.flushResume();
    const d2 = JSON.parse(localStorage.getItem(St.SAVE_KEY));
    eq('续档重写后 right 那条不变', d2.resume.ink.right, d.resume.ink.right);
    eq('续档重写后 down 那条不变', d2.resume.ink.down, d.resume.ink.down);
    eq('续档重写后步数不变', d2.resume.moves, f.saveMoves);
    ck('integrity 依然为 null（这盘面世的条件没变）', g.integrity === null, String(g.integrity));
    // 续完还能继续玩：随手补一笔
    const next = scriptOf(f).find((x) => g.valueAt(x.i, x.dir) === G.UNKNOWN);
    await clickBtn(toolBtnFor(next.want));
    await pointerTap(next.i, next.dir);
    eq('续完还能落笔', g.valueAt(next.i, next.dir), next.want);
    eq('落笔后已定 +1', S().decided, f.saveDecided + 1);
    return report({ moves: S().moves, hints: S().hints, decided: S().decided, seed: g.puzzle.seed });
  };

  // ================================================================ layout
  const layout = async () => {
    await wipe();
    const f = bySeed('scn|hard|0');
    const B = await mod('js/render/board.js');
    const g = await openUntil('scn|hard|0');
    const shell = document.getElementById('shell');
    eq('#shell 的 max-width 是 CSS 里那个（本仓没有 #app，容器就是 #shell）', getComputedStyle(shell).maxWidth, '940px');
    const RUNGS = [940, 760, 600, 470, 400, 340, 300, 260, 240];
    const cells = [];
    const bad = { squash: [], grow: [], hscroll: [], centred: [], overflow: [], reach: [], min: [], max: [], left: [] };
    for (const mw of RUNGS) {
      shell.style.maxWidth = `${mw}px`;
      window.dispatchEvent(new Event('resize'));
      await wait(60);
      const gg = geo();
      const cr = canvasRect();
      const fb = frameBox();
      const fr = frameRect();
      cells.push(gg.cell);
      // 1) 画布盒子必须等于渲染层自己算的那套数：CSS 不许把它压进容器
      if (Math.abs(cr.width - gg.w) > 0.01 || Math.abs(cr.height - gg.h) > 0.01) {
        bad.squash.push(`${mw}: rect=${Math.round(cr.width)}×${Math.round(cr.height)} geo=${gg.w}×${gg.h}`);
      }
      if (A().dom.canvas.width !== Math.round(gg.w * gg.dpr)) bad.squash.push(`${mw}: backing=${A().dom.canvas.width}`);
      // 2) 格子不许越界，也不许被压到 44 以下
      if (gg.cell < B.Cell.min) bad.min.push(`${mw}: cell=${gg.cell} < ${B.Cell.min}`);
      if (gg.cell > B.Cell.max) bad.max.push(`${mw}: cell=${gg.cell} > ${B.Cell.max}`);
      // 3) 容器缩小时格子只能不增
      // 4) 页面永远不许出现横向滚动条
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth) bad.hscroll.push(`${mw}: doc ${de.scrollWidth}>${de.clientWidth}`);
      if (document.body.scrollWidth > de.clientWidth) bad.hscroll.push(`${mw}: body ${document.body.scrollWidth}>${de.clientWidth}`);
      // 5) 溢出只能落在右边（滚得回去的那一侧），并且溢出量必须等于这条框自己的滚动范围
      const over = Math.max(0, Math.round(cr.width - fb.width));
      const scroll = A().dom.frame.scrollWidth - A().dom.frame.clientWidth;
      if (over !== scroll) bad.overflow.push(`${mw}: canvas 溢出 ${over} 而 frame 可滚 ${scroll}`);
      if (cr.left < fb.left - 0.6) bad.left.push(`${mw}: 画布左边跑到容器外 ${Math.round((cr.left - fb.left) * 10) / 10}`);
      // 6) 放得下时画布居中（margin-inline:auto），放不下时贴左
      if (over === 0) {
        const lGap = cr.left - fb.left;
        const rGap = fb.right - cr.right;
        if (Math.abs(lGap - rGap) > 1.5) bad.centred.push(`${mw}: 左 ${Math.round(lGap)} 右 ${Math.round(rGap)}`);
      }
      // 7) 每一条内部边的命中盒两侧都必须"滚得到、点得中"
      const maxScroll = A().dom.frame.scrollWidth - A().dom.frame.clientWidth;
      for (const e of g.edges) {
        for (const side of [0, 1]) {
          const p0 = hitPts(e.i, e.dir)[side];
          const need = Math.max(0, Math.min(maxScroll, Math.max(0, p0.x - (fb.left + fb.width * 0.5))));
          A().dom.frame.scrollLeft = need;
          const p = hitPts(e.i, e.dir)[side];
          const fr2 = frameRect();
          const fb2 = frameBox();
          const vis = p.x >= fb2.left - 0.5 && p.x <= fb2.right - 0.5 && p.y >= fr2.top - 0.5 && p.y <= fr2.bottom + 0.5;
          const h = A().hitAt(p.x, p.y);
          if (!vis || !h || slotKey(h.i, h.dir) !== slotKey(e.i, e.dir)) {
            bad.reach.push(`${mw}:${e.i}/${e.dir}/侧${side} vis=${vis} 解到 ${h ? `${h.i}/${h.dir}(${slotKey(h.i, h.dir)})` : 'null'} 应为 ${slotKey(e.i, e.dir)}`);
          }
          A().dom.frame.scrollLeft = 0;
        }
      }
      await wait(10);
    }
    for (let k = 1; k < cells.length; k++) {
      if (cells[k] > cells[k - 1]) bad.grow.push(`${RUNGS[k]}px 处 cell ${cells[k - 1]}→${cells[k]}（容器变小格子反而变大）`);
    }
    shell.style.maxWidth = '';
    window.dispatchEvent(new Event('resize'));
    await wait(60);
    const back = geo();
    eq('把 max-width 收回去之后画布回到原来那套几何', `${back.cell}×${back.w}`, `${cells[0]}×${back.w}`);
    eq('收回后画布仍然不被压', Math.round(canvasRect().width * 100) / 100, back.w);
    ck(`容器阶梯 ${RUNGS.join('/')} 上画布盒子始终等于 geo（不被压）`, bad.squash.length === 0, bad.squash.slice(0, 4).join(' | '));
    ck('格子边长随容器单调不增', bad.grow.length === 0, bad.grow.join(' | '));
    ck(`格子始终在 [${B.Cell.min}, ${B.Cell.max}] 里`, bad.min.length === 0 && bad.max.length === 0, `下溢 ${bad.min.join(' ')} 上溢 ${bad.max.join(' ')}`);
    ck('整条阶梯上页面都没有横向滚动条', bad.hscroll.length === 0, bad.hscroll.join(' | '));
    ck('溢出量 = #board-frame 自己的滚动范围（多的那截滚得回来）', bad.overflow.length === 0, bad.overflow.join(' | '));
    ck('溢出只落在右边（画布左边从不跑出容器）', bad.left.length === 0, bad.left.join(' | '));
    ck('放得下时画布在容器里居中', bad.centred.length === 0, bad.centred.join(' | '));
    ck(`每 rung × ${g.edges.length} 条边 × 两侧命中盒都滚得到、点得中`, bad.reach.length === 0, bad.reach.slice(0, 6).join(' | '));
    const de = document.documentElement;
    ck('阶梯走完以后累计的条数与格子序列都打出来', cells.length === RUNGS.length, cells.join(','));
    return report({ cells: cells.join(''), edges: g.edges.length, doc: `${de.clientWidth}×${de.clientHeight}`, rungCount: RUNGS.length });
  };

  // ================================================================ narrow（真手机视口，非改 max-width）
  const narrow = async () => {
    await wipe();
    const f = bySeed('scn|easy|0');
    const B = await mod('js/render/board.js');
    eq('视口被换成 390×844', `${window.innerWidth},${window.innerHeight}`, '390,844');
    const g = await openUntil('scn|easy|0');
    const gg = geo();
    const cr = canvasRect();
    const fb = frameBox();
    const de = document.documentElement;
    eq('手机视口下画布盒子仍然等于 geo（没被压）', `${Math.round(cr.width * 100) / 100},${Math.round(cr.height * 100) / 100}`, `${gg.w},${gg.h}`);
    ck(`格子边长 ${gg.cell} 在 [${B.Cell.min},${B.Cell.max}] 里`, gg.cell >= B.Cell.min && gg.cell <= B.Cell.max, `cell=${gg.cell}`);
    ck('页面没有横向滚动条', de.scrollWidth <= de.clientWidth, `${de.scrollWidth}>${de.clientWidth}`);
    ck('画布左边不跑出容器', cr.left >= fb.left - 0.6, `${Math.round(cr.left - fb.left)}`);
    ck('容器放不下时由 #board-frame 自己滚，溢出的量滚得回来',
      (A().dom.frame.scrollWidth - A().dom.frame.clientWidth) === Math.max(0, Math.round(cr.width - fb.width)),
      `scroll=${A().dom.frame.scrollWidth - A().dom.frame.clientWidth} over=${Math.max(0, Math.round(cr.width - fb.width))}`);
    let reachBad = [];
    const maxScroll = A().dom.frame.scrollWidth - A().dom.frame.clientWidth;
    for (const e of g.edges) {
      for (const side of [0, 1]) {
        const p0 = hitPts(e.i, e.dir)[side];
        const need = Math.max(0, Math.min(maxScroll, Math.max(0, p0.x - (fb.left + fb.width * 0.5))));
        A().dom.frame.scrollLeft = need;
        const p = hitPts(e.i, e.dir)[side];
        const fb2 = frameBox();
        const vis = p.x >= fb2.left - 0.5 && p.x <= fb2.right - 0.5;
        const h = A().hitAt(p.x, p.y);
        if (!vis || !h || slotKey(h.i, h.dir) !== slotKey(e.i, e.dir)) reachBad.push(`${e.i}/${e.dir}/侧${side}`);
        A().dom.frame.scrollLeft = 0;
      }
    }
    ck(`390px 下 ${g.edges.length} 条边的命中盒两侧都滚得到、点得中`, reachBad.length === 0, reachBad.slice(0, 6).join(' '));
    // 手机上控件本身也必须点得到：工具条与三枚工具都要在视口宽里
    const ctlBad = ['#tool-wall', '#tool-same', '#tool-erase', '#btn-hint', '#btn-prune', '#btn-undo', '#btn-new', '#btn-menu'].filter((sel) => {
      const r = $(sel).getBoundingClientRect();
      return r.width < 1 || r.right > window.innerWidth + 0.6 || r.left < -0.6;
    });
    ck('工具条上那 8 枚控件都完整落在视口宽度里', ctlBad.length === 0, ctlBad.join(' '));
    const hudBad = ['#hud-clock', '#hud-tier', '#hud-size', '#hud-seed', '#hud-score', '#hud-blocks', '#hud-unknown', '#hud-walls', '#hud-merged', '#hud-moves', '#hud-hints', '#hud-clash'].filter((sel) => !shown(sel));
    ck('12 枚 HUD 读数在手机视口下都看得见', hudBad.length === 0, hudBad.join(' '));
    // 真指针在手机上仍然写对那条边
    const sc = scriptOf(f);
    await clickBtn(toolBtnFor(sc[0].want));
    await pointerTap(sc[0].i, sc[0].dir);
    eq('手机视口下一次真实点按写的是那条边', g.valueAt(sc[0].i, sc[0].dir), sc[0].want);
    eq('已定 1', S().decided, 1);
    eq('没有说不通', S().clashes, 0);
    return report({ cell: gg.cell, canvas: `${gg.w}×${gg.h}`, frame: Math.round(fb.width), viewport: `${window.innerWidth}×${window.innerHeight}` });
  };

  // ================================================================ pause：暂停冻住的两样，与顶栏那两颗手动控件
  //
  // 前九场没有一次真的点过 #btn-pause / #btn-fullscreen：「暂停」到底冻住了什么、全屏按钮的
  // aria-pressed 会不会跟着状态回写，全靠读代码。这一场把它们量成可复算的数字。
  //
  // 暂停要冻**两样**：读数（js/main.js 的 setPaused 把 baseMs 结算后把 startedAt 清零，clock()
  // 从此恒等于 baseMs）与盘面（js/main.js 的 blockedWhilePaused）。只冻读数不冻盘面，榜是按 ms
  // 排名的（js/store.js:140 `return a.ms < b.ms;`），暂停于是变成免费的思考时间。
  const pause = async () => {
    await wipe();
    const a = A();
    if (typeof a.setPaused !== 'function' || typeof a.simClock !== 'function' || typeof a.elapsed !== 'function') {
      ck('暂停：window.tatamibari 交出 setPaused / elapsed / simClock 这张给闸台读的脸', false,
        `只有 ${Object.keys(a).slice(0, 12).join(',')}`);
      return report({ fatal: 'no surface' });
    }
    const errs0 = PROBE.js.length;
    const lab = (id) => {
      const b = document.getElementById(id) || {};
      return {
        text: (b.textContent || '').trim(),
        pressed: b.getAttribute && b.getAttribute('aria-pressed'),
        title: b.getAttribute && b.getAttribute('title'),
        disabled: b.disabled === true,
      };
    };
    // 合成 KeyboardEvent 要 cancelable 才谈得上 defaultPrevented；本场的 keyd 助手（line 724 那个）
    // 不带这个标志，这里单独造一颗，不动那个助手。
    const kd = (key) => {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };

    eq('暂停：HUD 右上角那颗手动控件名册逐字对上（顺序、条数、id 全算）',
      [...document.querySelectorAll('.hud-right button')].map((b) => b.id).join(','),
      'btn-pause,btn-fullscreen');
    eq('暂停：工具条三段按钮名册逐字对上',
      [...document.querySelectorAll('.toolbar button')].map((b) => b.id).join(','),
      'tool-wall,tool-same,tool-erase,btn-hint,btn-prune,btn-undo,btn-new,btn-menu');
    eq('暂停：这些控件每一颗都写着名字（空 textContent 时读屏只剩一个 role）',
      [...document.querySelectorAll('.hud-right button, .toolbar button')]
        .filter((b) => !(b.textContent || '').trim()).length, 0);
    const p0 = lab('btn-pause');
    const f0 = lab('btn-fullscreen');
    ck('暂停：开局没有一处偷偷停在暂停态（引擎、按钮文字、aria-pressed 三处一起说没暂停）',
      a.paused === false && p0.text === '暂停' && p0.pressed === 'false', `${a.paused}/${p0.text}/${p0.pressed}`);
    ck('暂停：暂停那颗键 title 写了两个键（P 与 Space），下面各自要验',
      /P/.test(p0.title || '') && /Space/.test(p0.title || ''), p0.title);
    ck('暂停：全屏按钮开局可点、写着「全屏」、title 说了键位 F',
      !f0.disabled && f0.text === '全屏' && /F/.test(f0.title || ''), `${f0.text}/${f0.disabled}/${f0.title}`);

    // ---- 全屏两条腿排在最前面：一次 Runtime.evaluate 只发一份瞬时用户激活（约几秒就过期），
    // 第一下 requestFullscreen() 就把它吃掉。这一串如果排在任何 wait 之后，连"第一次进入"都会
    // 被拒——那是 headless 的授权上限，不是产品缺陷（上一仓就是这么红的）。
    const w0 = innerWidth;
    const inFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    await clickBtn('#btn-fullscreen');
    await wait(500);
    let fs = 'unsupported';
    if (inFs()) {
      fs = 'entered';
      const on = lab('btn-fullscreen');
      ck('暂停：进全屏后按钮标成按下、文字改成「退出全屏」（回写走 fullscreenchange，不是点击那一行）',
        on.pressed === 'true' && on.text === '退出全屏', `${on.text}/${on.pressed}`);
      ck('暂停：body 的 fullscreen 类跟着进', document.body.classList.contains('fullscreen'),
        [...document.body.classList].join(' '));
      const f = await openUntil('scn|newbie|0');
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      ck('暂停：全屏没有撑出横向滚动', overflow <= 1, `溢出 ${overflow} px`);
      const r = canvasRect();
      ck('暂停：全屏里棋盘整个在视口内',
        r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        `[${Math.round(r.left)},${Math.round(r.top)}] ${Math.round(r.width)}×${Math.round(r.height)} 视口 ${innerWidth}×${innerHeight}`);
      ck('暂停：全屏里那盘仍是夹具那一盘（尺寸、seed 都没被换）', `${f.w}×${f.h}|${f.puzzle.seed}`, '4×4|scn|newbie|0');
      const claimed = kd('f');
      await wait(500);
      ck('暂停：按 F 真的退出全屏（title 里那句（F）不是装饰）', !inFs(), '按 F 之后还在全屏里');
      ck('暂停：F 的处理器确实认领了这颗键（defaultPrevented 为真）', claimed,
        '合成 F 事件没被 js/main.js 的全屏 handler 消费');
      const off = lab('btn-fullscreen');
      eq('暂停：退出后按钮文字回到「全屏」', off.text, '全屏');
      eq('暂停：退出后 aria-pressed 回假', off.pressed, 'false');
      ck('暂停：退出后 body 的 fullscreen 类摘掉', !document.body.classList.contains('fullscreen'),
        [...document.body.classList].join(' '));
      ck('暂停：退出后视口宽度复原', innerWidth === w0, `${w0} → ${innerWidth}`);
      ck('暂停：没绑的键不冒充玩家输入（对照组：q 不该被消费）', !kd('q'),
        '一个没绑的键也被 preventDefault 了，上面那条"认领"就量不出绑定');
      // 这份激活已经被第一次进入吃掉了，所以这一下**必然**被 Chrome 拒（NotAllowedError）。
      // 要断的是：一次"没给许可"不许冒充"这台机器不行"。上一版把任何 rejection 都送去
      // unsupported()，于是这颗按钮被永久禁掉、title 还谎称"这个浏览器不提供元素全屏"——
      // 在真人那儿这等于一次抖动就把功能拆了。
      await clickBtn('#btn-fullscreen');
      await wait(450);
      const againBtn = lab('btn-fullscreen');
      ck('暂停：请求被拒之后按钮还在（不被谎报成"本浏览器不支持"）',
        !inFs() && againBtn.disabled === false && /F/.test(againBtn.title || '') && againBtn.pressed === 'false',
        `disabled=${againBtn.disabled} title=${againBtn.title} pressed=${againBtn.pressed}`);
    } else {
      fs = 'refused';
      const off = lab('btn-fullscreen');
      // 这一支不能拿"没进全屏"判本作的红：Chrome 拒的是一次**授权**（要瞬时用户激活、标签要在
      // 最前），那是 headless 的天花板。能断的是本作对自己的说法——js/main.js 只在探不到请求
      // 方法时才禁用按钮并写明原因，探得到就必须保持可点、title 里的（F）还在。
      const de = document.documentElement;
      const hasReq = !!(de.requestFullscreen || de.webkitRequestFullscreen || de.msRequestFullscreen);
      ck('暂停：按钮状态就是本作对「能不能全屏」的说法（有方法→可点且写键位，无方法→禁用且写原因）',
        hasReq ? (!off.disabled && /F/.test(off.title || ''))
               : (off.disabled === true && /主屏幕|不提供/.test(off.title || '')),
        `有方法=${hasReq} disabled=${off.disabled} title=${off.title}`);
      ck('暂停：被拒绝的时候不假装按下', off.pressed !== 'true', `${off.text}/${off.pressed}`);
      const f = await openUntil('scn|newbie|0');
      ck('暂停：这一支也要把夹具那盘开出来（后面的时钟与锁盘断言要用它）',
        `${f.w}×${f.h}|${f.puzzle.seed}`, '4×4|scn|newbie|0');
    }

    const advance = async (ms) => { const c0 = a.simClock(); await wait(ms); return a.simClock() - c0; };
    const running = await advance(320);
    ck('暂停：没按暂停时表按墙钟走（320 ms 里至少推进 150 ms）', running >= 150, `Δ=${running}`);
    // #hud-clock 由那个 1000 ms 的 ticker 写。先证明 ticker 活着，下一条「暂停中它不再变」
    // 才不是量了一句没人写的死文本。
    const hudRun0 = text($('#hud-clock'));
    await wait(1400);
    const hudRun1 = text($('#hud-clock'));
    ck('暂停：走表时 HUD 那行时间确实在刷新（对照组，ticker 活着）', hudRun1 !== hudRun0, `${hudRun0} → ${hudRun1}`);

    await clickBtn('#btn-pause');
    const p1 = lab('btn-pause');
    ck('暂停：点 #btn-pause 三处一起改口（引擎说在暂停、按钮写「继续」、aria-pressed 变真）',
      a.paused === true && p1.text === '继续' && p1.pressed === 'true', `${a.paused}/${p1.text}/${p1.pressed}`);
    const frozen = await advance(700);
    eq('暂停：暂停把读数冻死（700 ms 之后 Δ 恰好是 0，不是「变慢了」）', frozen, 0);
    const hudPause0 = text($('#hud-clock'));
    await wait(1400);
    eq('暂停：暂停中 HUD 那行时间不再被 ticker 重画', text($('#hud-clock')), hudPause0);

    // 盘面侧：每一类落子入口都按一遍。#btn-hint / #btn-prune / #btn-undo 与三枚工具按钮走的是
    // 函数口（不经 keydown 那条总闸），A().tap / stroke / revealAll 更是绕过命中测试的编程等价物
    // ——三条路都得各挡各的，漏一条就等于没锁。
    const g = () => A().game;
    const snap = () => {
      const s = S();
      const ink = g().ink();
      return {
        ink: `${ink.right.join(',')}|${ink.down.join(',')}`,
        mv: s.moves, ht: s.hints, pr: s.prunes, dec: s.decided, walls: s.walls, merged: s.merged,
        mode: g().mode, st: s.status,
      };
    };
    const sc = scriptOf(bySeed('scn|newbie|0'));
    const e0 = sc[0];
    const e1 = sc[1];
    const e2 = sc[2];
    const was = snap();
    await pointerTap(e0.i, e0.dir);
    // 一笔拖要**两个**取样点才走得到 stroke()：pointerDrag 只有一条边时按下即抬起，落进的是 tap
    // 那条分支，那样"拖一笔被挡"这句断言量的其实是又一次点按。
    await pointerDrag([{ i: e1.i, dir: e1.dir }, { i: e2.i, dir: e2.dir }], false);
    await clickBtn('#btn-hint');
    await clickBtn('#btn-prune');
    await clickBtn('#btn-undo');
    await clickBtn('#tool-same');
    await clickBtn('#tool-erase');
    kd('1'); kd('2'); kd('3'); kd('m'); kd('h'); kd('g'); kd('z');
    const blockedApi = [
      a.tap(e0.i, e0.dir, 1),
      a.stroke([{ i: e1.i, dir: e1.dir }, { i: e2.i, dir: e2.dir }], 1),
      a.revealAll(),
    ];
    const now = snap();
    eq('暂停：暂停中把点边/拖一笔/提示/补墙/撤销/切工具/按键/API 直调全按一遍，盘上一条边都没动', now.ink, was.ink);
    eq('暂停：暂停中不记步数', now.mv, was.mv);
    eq('暂停：暂停中按提示不计费', now.ht, was.ht);
    eq('暂停：暂停中补墙也不记那一眼', now.pr, was.pr);
    eq('暂停：暂停中已定边数不变', now.dec, was.dec);
    eq('暂停：暂停中墙数与打通数都不变', `${now.walls}/${now.merged}`, `${was.walls}/${was.merged}`);
    eq('暂停：暂停中切工具不生效（模式还是那一枚）', now.mode, was.mode);
    ck('暂停：绕过命中测试那三个 API 确实被挡回了 null（不是"返回值没人看"）',
      blockedApi.every((r) => r === null), blockedApi.map((r) => JSON.stringify(r)).join(','));
    ck('暂停：被拦下的那一下要说人话（#status-line 带 aria-live，读屏会念）',
      /暂停挡住了/.test(text($('#status-line'))) && $('#status-line').getAttribute('aria-live') === 'polite',
      `${text($('#status-line'))}｜aria-live=${$('#status-line').getAttribute('aria-live')}`);
    ck('暂停：页面上那句键位说明写了暂停会锁盘（承诺写在脸上，也得写在断言里）',
      /暂停中盘面不接受操作/.test([...document.querySelectorAll('.legend')].map((n) => n.textContent).join(' ')),
        [...document.querySelectorAll('.legend p, .legend')].length + ' 段 legend');

    const atPause = a.simClock();
    await clickBtn('#btn-pause');
    const jump = a.elapsed() - atPause;
    ck('暂停：恢复的第一帧不倒灌暂停那几秒（Δ < 200 ms，不是把暂停的 2 秒一次吃掉）', jump < 200, `Δ=${jump}`);
    eq('暂停：恢复时按钮改回「暂停」', lab('btn-pause').text, '暂停');
    const resumed = await advance(260);
    ck('暂停：恢复后表重新按墙钟走', resumed >= 50, `Δ=${resumed}`);
    // 对照组：同一批入口在恢复之后必须立刻生效，否则"锁盘"只是把游戏打死。
    await clickBtn(toolBtnFor(e0.want));
    await pointerTap(e0.i, e0.dir);
    eq('暂停：恢复后那一下真的落上（锁盘不是全场死）', g().valueAt(e0.i, e0.dir), e0.want);
    eq('暂停：恢复后落子照常记步数', S().moves, was.mv + 1);
    const hBack = a.useHint();
    ck('暂停：恢复后提示也回来了（并且计费一次）', !!hBack && S().hints >= 1,
      `hint=${hBack ? '给了' : 'null'} 提示数=${S().hints}`);

    kd('p');
    eq('暂停：title 写的第一个键 P 真的停表', a.paused, true);
    const frozenP = await advance(300);
    eq('暂停：P 停住之后 300 ms 里表一动不动', frozenP, 0);
    kd(' ');
    ck('暂停：title 写的另一个键（空格）也认，而且真的松开',
      a.paused === false && lab('btn-pause').text === '暂停', `paused=${a.paused}/${lab('btn-pause').text}`);
    const afterSpace = await advance(260);
    ck('暂停：空格松开之后表接着走', afterSpace >= 50, `Δ=${afterSpace}`);

    // 总闸放行的那两颗键各走一遍：N 换一局（新局一定在走）、Esc 回选档（不改这盘的盘面）。
    kd('p');
    eq('暂停：为这两条腿再冻一次表', a.paused, true);
    kd('n');
    await wait(60);
    for (let i = 0; i < 1200 && (a.game && a.game.puzzle.seed === 'scn|newbie|0'); i++) await wait(25);
    ck('暂停：暂停中按 N 换得出新局，而且新局一定在走（按钮与时钟不许各说各话）',
      a.paused === false && lab('btn-pause').text === '暂停' && lab('btn-pause').pressed === 'false'
        && a.game.puzzle.seed !== 'scn|newbie|0',
      `paused=${a.paused}/${lab('btn-pause').text}/seed=${a.game && a.game.puzzle.seed}`);
    const afterNew = await advance(300);
    ck('暂停：换出来的那一局顶着的表在走', afterNew >= 50, `Δ=${afterNew}`);
    kd('p');
    kd('Escape');
    await wait(60);
    ck('暂停：暂停中按 Esc 能回选档（锁的是盘，不是整个界面）', a.view() === 'menu' && a.paused === true,
      `view=${a.view()} paused=${a.paused}`);
    await openUntil('scn|newbie|0');
    ck('暂停：从选档重新开的那一盘不再顶着暂停态', a.paused === false && lab('btn-pause').text === '暂停',
      `paused=${a.paused}/${lab('btn-pause').text}`);
    const afterReopen = await advance(300);
    ck('暂停：重新开局之后表在走（续档那条路也不留死表）', afterReopen >= 50, `Δ=${afterReopen}`);

    const errsNow = PROBE.js.length - errs0;
    ck('暂停：这一场没有未捕获异常 / 未处理 rejection / console.error',
      errsNow === 0, PROBE.js.slice(errs0, errs0 + 3).join(' | '));
    return report({
      fs, focus: document.hasFocus(), fsEnabled: document.fullscreenEnabled,
      running, frozen, frozenP, jump, resumed, afterSpace, afterNew, afterReopen,
      hud: `${hudRun0}→${hudRun1}→${text($('#hud-clock'))}`, errs: errsNow,
    });
  };

  w.__scn = { first, play, undo: undoScn, hint, clash, win, save, resume, layout, narrow, pause };
  w.__fixture = FIXTURE;
})(window);
