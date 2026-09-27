// 规则模型 · 畳バリ / Tatamibari
//
// 盘面切成若干长方形，每块恰好含一个记号（`+` 正方形 / `-` 宽>高 / `|` 高>宽），
// 并且**任何一个格点都不能是四块的公共角**。本文件只负责后一条，以及"什么算长方形"。
//
// 坐标约定：
//   格子 (r, c)，r∈[0,h) 向下、c∈[0,w) 向右；linear = r*w + c。
//   格点 (x, y)，x∈[0,w] 是竖线编号、y∈[0,h] 是横线编号。
//   内点 (x,y)（1≤x<w、1≤y<h）四周的四格是 NW=(y-1,x-1) NE=(y-1,x) SW=(y,x-1) SE=(y,x)。
//
// "禁四角共点"有两种彼此独立的写法，本文件两个都实现，测试台断言它们在长方形分块上
// 恒等——几何法（`cornerCountAt`）从每块的外接框算角，窗口法（`windmillPoints`）只看
// 四格是否互不相同。两者一致**不是免费的**，它依赖"每块都是长方形"这个前提，
// 所以规则测试同时给出一张非长方形 labeling，让两者在该盘上确实分歧。

/** 每块的外接框：Map(regionId -> {r0, r1, c0, c1})。忽略 -1（未定格）。 */
export function regionBoxes(labeling, w, h) {
  const boxes = new Map();
  for (let i = 0; i < w * h; i++) {
    const id = labeling[i];
    if (id < 0) continue;
    const r = (i / w) | 0, c = i % w;
    const b = boxes.get(id);
    if (!b) boxes.set(id, { r0: r, r1: r, c0: c, c1: c });
    else {
      if (r < b.r0) b.r0 = r;
      if (r > b.r1) b.r1 = r;
      if (c < b.c0) b.c0 = c;
      if (c > b.c1) b.c1 = c;
    }
  }
  return boxes;
}

/** 每块格数 */
export function regionSizes(labeling) {
  const s = new Map();
  for (const id of labeling) if (id >= 0) s.set(id, (s.get(id) || 0) + 1);
  return s;
}

/** 分块是否全为长方形：某块的格数等于它外接框的面积，当且仅当它填满了外接框。 */
export function isRectangular(labeling, w, h) {
  const boxes = regionBoxes(labeling, w, h);
  const sizes = regionSizes(labeling);
  for (const [id, b] of boxes) {
    const area = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    if (sizes.get(id) !== area) return false;
  }
  return true;
}

/**
 * 几何法：格点 (x,y) 是几块的公共角。
 * 一块以 (x,y) 为角 ⇔ x ∈ {c0, c1+1} 且 y ∈ {r0, r1+1}。
 * 注意"占据点两侧"的块不算角：例如某块横跨 (x-1,x) 两列，则 x 不在其 {c0,c1+1} 里，
 * 点落在它的边上——这正是 T 形连接只贡献 2 个角的原因。
 */
export function cornerCountAt(labeling, w, h, x, y) {
  let n = 0;
  for (const b of regionBoxes(labeling, w, h).values()) {
    if ((x === b.c0 || x === b.c1 + 1) && (y === b.r0 || y === b.r1 + 1)) n++;
  }
  return n;
}

/** 几何法：所有角数 ≥ 4 的内点。 */
export function cornerViolations(labeling, w, h) {
  const out = [];
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const n = cornerCountAt(labeling, w, h, x, y);
      if (n >= 4) out.push({ x, y, corners: n });
    }
  }
  return out;
}

/** 四格环绕某点的 labeling 形状：返回四个 regionId（-1 表示该格未定）。 */
export function aroundPoint(labeling, w, x, y) {
  return [
    labeling[(y - 1) * w + (x - 1)], // NW
    labeling[(y - 1) * w + x],       // NE
    labeling[y * w + (x - 1)],       // SW
    labeling[y * w + x],             // SE
  ];
}

/**
 * 单点版窗口法，允许 labeling 只填了一部分：四格有一格未定格就返回 false。
 * 计数器的剪枝需要这个性质——它每放置一块就检查该块环带上的点，
 * 而此时环带上可能有格还没填。"未定格 ⇒ 不判违规"是安全的，因为已定格的格不会再改；
 * 反过来若该点日后会违规，它一定在某次放置后四格齐了的那一刻被抓到。
 * 与整盘版 `cornerViolations`（几何法）在完整长方形分块上恒等，由 rule-test 逐点断言。
 */
export function pointWindmill(labeling, w, h, x, y) {
  if (x < 1 || y < 1 || x > w - 1 || y > h - 1) return false;
  const q = aroundPoint(labeling, w, x, y);
  if (q.some((id) => id < 0)) return false;
  return q[0] !== q[1] && q[0] !== q[2] && q[0] !== q[3] &&
    q[1] !== q[2] && q[1] !== q[3] && q[2] !== q[3];
}

/** 窗口法：四格互不相同的内点（"风车"）。有未定格的内点不算命中。 */
export function windmillPoints(labeling, w, h) {
  const out = [];
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      if (pointWindmill(labeling, w, h, x, y)) out.push({ x, y, ids: aroundPoint(labeling, w, x, y) });
    }
  }
  return out;
}

/** 违规点集合的规范化比较串，用于断言两条通道给出同一份答案。 */
export function violationSignature(points) {
  return points.map((p) => `${p.x},${p.y}`).sort().join(' | ');
}
