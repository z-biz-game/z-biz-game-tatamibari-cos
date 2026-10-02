#!/usr/bin/env python3
"""畳バリ (Tatamibari) 全套位图资产工厂：1024 母图 + 各尺寸派生 + 盘内榻榻米纹 + 粒子 sprite + HUD 字形 + 社交卡。

用法（可复现：不联网、不读时钟、不碰仓库外的任何东西）：

    python3 assets/gen/make_art.py            # 全量重刷
    python3 assets/gen/make_art.py --list     # 只列将要产出的文件

图标与纹理的形状就是玩法本身：墙把棋盘切成长方形块、每块恰好一个记号（「-」宽>高、「|」高>宽、
「+」正方形），且任何一个格点上不许四块共角。所以本脚本**先现搜出一张真满足这四条的 4×4 分块**，
再照它画——不临摹一张凭印象的格子图。搜索是确定性的（固定枚举顺序、不碰 random、不读时钟），
同一份源码重刷出同一批字节；任何一条判据不成立就非零退出，图标不许画一个不合法的盘。

母题与配色取自 css/game.css 的自定义属性（--bg/--surface/--accent-edge/--mark/--hint/--success），
渲染层 js/render/board.js 读的是同一份变量，于是图标与实盘不会长成两副样子。

产出（index.html / manifest.webmanifest / sw.js / js/render/board.js 引用的就是这些路径）：
    icons/icon-1024.png                       母图
    icons/icon-{512,192,180,96,64,48,32,16}.png
    icons/icon-maskable-{512,192}.png         Android maskable（主体缩进 80% 安全区）
    icons/apple-touch-icon.png                iOS 桌面（180）
    icons/favicon-{32,16}.png                 小尺寸走紧凑母题（细墙在小图上会糊成一团）
    icons/icon-manifest.json                  这批文件的尺寸/字节/母题记录（含分块与搜索证据）
    assets/og-cover.png                       1200×630 社交卡
    assets/textures/tatami-weave.png          可平铺榻榻米纹，画在盘面底与选档卡片上
    assets/textures/tatami-weave-light.png    亮色主题那一份
    assets/sprites/dust-burst.png             软边粒子 sprite（提示光带 / 胜利墨点）
    assets/ui/{sound-on,sound-off,pause,resume,restart,fullscreen,motion}.png  HUD 字形（96）
"""
import argparse
import json
import math
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat
except ImportError:  # pragma: no cover
    sys.stderr.write('需要 Pillow（与量具 make_icons.py 同一条依赖）：pip3 install Pillow\n')
    raise SystemExit(3)

HERE = os.path.abspath(os.path.dirname(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
CSS = os.path.join(REPO, 'css', 'game.css')

ICONS = [1024, 512, 192, 180, 96, 64, 48, 32, 16]
TEXTURE = 128
UI_GLYPH = 96


# ---------------------------------------------------------------- 配色来源

def read_colors():
    """颜色只有 css/game.css 一份来源：这里按 --名字 抓十六进制，抓不到就炸。

    与 js/render/board.js 的 CSS_VARS 同一条纪律——静默用一套抄来的颜色，图标就会跟实盘分家。
    """
    text = open(CSS, encoding='utf-8').read()
    want = ['bg', 'bg-2', 'surface', 'surface-lift', 'line', 'line-heavy',
            'ink', 'ink-dim', 'ink-faint', 'accent', 'accent-edge', 'success', 'hint', 'mark']
    got, missing = {}, []
    for k in want:
        # 只认 :root 块里字面量那条（var(--x) 那种别名交给下面单独解析）
        v = None
        for line in text.splitlines():
            s = line.strip()
            if s.startswith(f'--{k}:') and '#' in s:
                v = s.split('#', 1)[1].split()[0].split(';')[0].strip()
                break
        if not v or len(v) < 6:
            missing.append(k)
            continue
        got[k.replace('-', '_')] = tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))
    if missing:
        sys.stderr.write(f'css/game.css 缺少可解析的颜色：{missing}\n')
        raise SystemExit(4)
    return got


def hexs(c):
    return '#%02x%02x%02x' % c[:3]


# ---------------------------------------------------------------- 母题：真分块

MARK = {'h': '-', 'v': '|', 's': '+'}
SHAPE = {'h': '宽>高', 'v': '高>宽', 's': '正方形'}


def classify(w, h):
    return 'h' if w > h else 'v' if h > w else 's'


def blocks_4x4():
    """现搜一张合法的 4×4 畳バリ分块：每个长方形、三种形状都出场、任何格点上不四块共角。

    枚举是"第一个空格 + 覆盖它的所有长方形"那条标准搜索，顺序写死（按 (高,宽) 升序）⇒ 结果可复现。
    返回 (cells, boxes)：cells 是 16 格的块号，boxes 是每块的 (r0,c0,r1,c1,shape)。
    """
    N = 16
    sols = []

    def first_free(cells):
        for i in range(N):
            if cells[i] < 0:
                return i
        return -1

    def cross_ok(cells):
        """内部格点（3×3 个）四周四格最多来自 3 块——四块共角就是引擎里那条「风车」禁忌。"""
        for r in (1, 2, 3):
            for c in (1, 2, 3):
                around = {cells[(r - 1) * 4 + c - 1], cells[(r - 1) * 4 + c],
                          cells[r * 4 + c - 1], cells[r * 4 + c]}
                if len(around) >= 4:
                    return False
        return True

    def boxes_of(cells, k):
        out = [[16, 16, -1, -1] for _ in range(k)]
        for i, b in enumerate(cells):
            if b < 0:
                return None
            box = out[b]
            box[0] = min(box[0], i // 4)
            box[1] = min(box[1], i % 4)
            box[2] = max(box[2], i // 4)
            box[3] = max(box[3], i % 4)
        return out

    def search(cells, k):
        i = first_free(cells)
        if i < 0:
            boxes = boxes_of(cells, k)
            for b, (r0, c0, r1, c1) in enumerate(boxes):
                if (r1 - r0 + 1) * (c1 - c0 + 1) != sum(1 for x in cells if x == b):
                    return  # 不是长方形：本构造法不该产出，保底自校验
            kinds = [classify(c1 - c0 + 1, r1 - r0 + 1) for (r0, c0, r1, c1) in boxes]
            # 三种记号每种至少两块：只出场一次的图等于少说一条规则，也说明这盘太退化
            if any(kinds.count(s) < 2 for s in ('h', 'v', 's')):
                return
            if not cross_ok(cells):
                return
            sols.append(list(cells))
            return
        r, c = divmod(i, 4)
        # 面积从大到小试：先长后短 ⇒ 搜到的第一张就是块数最少的那一张
        for bh, bw in [(2, 2), (1, 4), (4, 1), (1, 3), (3, 1), (1, 2), (2, 1), (1, 1)]:
            if sols or k >= 7 or r + bh > 4 or c + bw > 4:
                continue
            nxt = list(cells)
            for rr in range(r, r + bh):
                for cc in range(c, c + bw):
                    nxt[rr * 4 + cc] = k
            search(nxt, k + 1)

    search([-1] * N, 0)
    if not sols:
        sys.stderr.write('4×4 合法分块搜索失败：没有一张同时满足长方形、三种形状各≥2、无四块共角\n')
        raise SystemExit(5)
    cells = sols[0]
    boxes = boxes_of(cells, len(set(cells)))
    out = []
    for r0, c0, r1, c1 in boxes:
        out.append((r0, c0, r1, c1, classify(c1 - c0 + 1, r1 - r0 + 1)))
    return cells, out


def marker_cell(box):
    """记号落在块内靠近几何中心的那一格（偶数尺寸取靠左上那一格，写死不成文由搜索保证同一张）。"""
    r0, c0, r1, c1, _ = box
    return ((r0 + r1) // 2, (c0 + c1) // 2)


# ---------------------------------------------------------------- 画法

def tile_weave(size, base, line, seed=20260926):
    """可平铺的榻榻米纹：横向细密经线 + 纵向疏纬线 + 一条压边。左右/上下严丝合缝（无断头线）。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    step = max(2, size // 32)
    for y in range(0, size, step):
        d.line((0, y, size, y), fill=line, width=1)
    # 纬线用整数周期，且周期必须整除 size ⇒ 平铺时接缝两侧的行号连续
    vstep = size // 4
    for x in range(0, size, vstep):
        d.line((x, 0, x, size), fill=line, width=1)
        d.line((x + vstep // 2, 0, x + vstep // 2, size), fill=(line[0], line[1], line[2], line[3] // 2), width=1)
    # 细碎的高光：周期同样的整数分格，避免随机噪点破坏可平铺性
    for i in range(0, size, size // 16):
        for j in range(0, size, size // 16):
            if ((i // (size // 16)) + (j // (size // 16))) % 3 == 0:
                d.rectangle((i, j, i + size // 32, j + size // 32),
                            fill=(base[0], base[1], base[2], 18))
    return img


def mix(a, b, t):
    """整数线性混合：PIL 画带 alpha 的填充是直接改像素而不是混合，所以半透明一律在这里折成实色。"""
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def draw_board(img, boxes, pal, x, y, cell, lw, weave=True):
    """把那张现搜出来的真分块画成棋盘：块色 → 榻榻米纹 → 墙。记号由 draw_markers 补。"""
    d = ImageDraw.Draw(img)
    total = len(boxes)
    for b, box in enumerate(boxes):
        r0, c0, r1, c1, _ = box
        px, py = x + c0 * cell, y + r0 * cell
        pw, ph = (c1 - c0 + 1) * cell, (r1 - r0 + 1) * cell
        hue = (b * 360 // total) % 360
        tint = hsl(hue, 0.46, 0.62, 1.0)[:3]
        d.rectangle((px, py, px + pw - 1, py + ph - 1), fill=mix(pal['surface'], tint, 0.30))
    # 纹理盖在块色上（小尺寸不铺：纹线跟墙会互相咬）
    if weave:
        tex = tile_weave(TEXTURE, pal['surface'], (pal['ink'][0], pal['ink'][1], pal['ink'][2], 16))
        region = img.crop((x, y, x + 4 * cell, y + 4 * cell))
        ov = Image.new('RGBA', region.size, (0, 0, 0, 0))
        for ty in range(0, region.size[1], TEXTURE):
            for tx in range(0, region.size[0], TEXTURE):
                ov.paste(tex, (tx, ty))
        region.alpha_composite(ov)
        img.paste(region, (x, y), region)
        d = ImageDraw.Draw(img)
    # 逐块描边即可得到全部墙：相邻两块描在同一条线上（外框也顺带齐了）
    d.line((x, y, x + 4 * cell - 1, y), fill=pal['accent_edge'], width=lw)
    for r0, c0, r1, c1, _ in boxes:
        px, py = x + c0 * cell, y + r0 * cell
        pw, ph = (c1 - c0 + 1) * cell, (r1 - r0 + 1) * cell
        d.rectangle((px, py, px + pw - 1, py + ph - 1), outline=pal['accent_edge'], width=lw)
    return d


def hsl(h, s, l, a):
    """标准 HSL→RGBA：与 js/render/board.js 的 tintOf 同一条口径（hue 按块序等分）。"""
    q = l + s - l * s if l > 0.5 else l * (1 + s)
    p = 2 * l - q

    def ch(t):
        if t < 0:
            t += 1
        if t > 1:
            t -= 1
        if t < 1 / 6:
            return p + (q - p) * 6 * t
        if t < 1 / 2:
            return q
        if t < 2 / 3:
            return p + (q - p) * (2 / 3 - t) * 6
        return p

    hh = h / 360.0
    return (round(ch(hh + 1 / 3) * 255), round(ch(hh) * 255), round(ch(hh - 1 / 3) * 255),
            int(a * 255))


def glyph_minus(d, cx, cy, k, color):
    d.line((cx - k, cy, cx + k, cy), fill=color, width=max(2, int(k * 0.34)))


def glyph_pipe(d, cx, cy, k, color):
    d.line((cx, cy - k, cx, cy + k), fill=color, width=max(2, int(k * 0.34)))


def glyph_plus(d, cx, cy, k, color):
    glyph_minus(d, cx, cy, k, color)
    glyph_pipe(d, cx, cy, k, color)


GLYPH = {'h': glyph_minus, 'v': glyph_pipe, 's': glyph_plus}


def draw_markers(d, boxes, pal, x, y, cell):
    """记号与实盘同一条口径：字符是 counter.js::MARKER_CHAR，颜色是 --ink。"""
    k = cell * 0.22
    for box in boxes:
        r, c = marker_cell(box)
        cx, cy = x + (c + 0.5) * cell, y + (r + 0.5) * cell
        GLYPH[box[4]](d, cx, cy, k, pal['ink'])


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def master(size, pal, boxes, mode='full'):
    """母图：夜底渐变 + 榻榻米底纹 + 一块 4×4 真解盘（`mode='compact'` 给 32/16 用）。"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    base = Image.new('RGB', (size, size))
    d0 = ImageDraw.Draw(base)
    for i in range(size):
        t = i / max(1, size - 1)
        d0.line((0, i, size, i), fill=tuple(int(pal['bg'][j] * (1 - t) + pal['bg_2'][j] * t) for j in range(3)))
    img.paste(base, (0, 0))
    margin = 0.10 if mode == 'full' else 0.06
    board_px = int(size * (1 - 2 * margin))
    cell = board_px // 4
    board_px = cell * 4
    x = (size - board_px) // 2
    y = (size - board_px) // 2
    lw = max(2, int(cell * (0.13 if mode == 'full' else 0.20)))
    if mode == 'full':
        tex = tile_weave(TEXTURE, pal['surface'], (pal['ink'][0], pal['ink'][1], pal['ink'][2], 14))
        ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
        for ty in range(0, size, TEXTURE):
            for tx in range(0, size, TEXTURE):
                ov.paste(tex, (tx, ty))
        img.alpha_composite(ov)
    d = draw_board(img, boxes, pal, x, y, cell, lw, weave=(mode == 'full'))
    draw_markers(d, boxes, pal, x, y, cell)
    if mode == 'full':
        # 右上角一条提示光带：呼应 --hint 那一条"UI 唯一被允许说看这里"的颜色
        d.line((x + board_px - cell, y + cell // 2, x + board_px - cell, y + cell * 1.5),
               fill=pal['hint'], width=max(2, int(cell * 0.10)))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), rounded_mask(size, int(size * (0.225 if mode == 'full' else 0.18))))
    return out


def maskable(img, size, bg):
    """maskable：主体缩到 80% 安全区，四周补纯色底（不许留透明，系统遮罩会裁掉圆角外沿）。"""
    pad = int(size * 0.10)
    small = img.resize((size - 2 * pad, size - 2 * pad), Image.LANCZOS)
    blank = Image.new('RGBA', (size, size), (*bg[:3], 255))
    blank.alpha_composite(small, (pad, pad))
    return blank


def load_font(px, cjk=True):
    cands = ([
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
    ] if cjk else []) + [
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/System/Library/Fonts/Helvetica.ttc',
    ]
    for p in cands:
        try:
            return ImageFont.truetype(p, px), os.path.basename(p)
        except Exception:
            continue
    return ImageFont.load_default(), 'pil-default'


def og_cover(pal, boxes):
    W, H = 1200, 630
    img = Image.new('RGBA', (W, H), pal['bg'] + (255,))
    d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / (H - 1)
        d.line((0, i, W, i), fill=tuple(int(pal['bg'][j] * (1 - t) + pal['bg_2'][j] * t) for j in range(3)))
    tex = tile_weave(TEXTURE, pal['surface'], (pal['ink'][0], pal['ink'][1], pal['ink'][2], 12))
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for ty in range(0, H, TEXTURE):
        for tx in range(0, W, TEXTURE):
            ov.paste(tex, (tx, ty))
    img.alpha_composite(ov)
    d = ImageDraw.Draw(img)
    cell = 96
    bx, by = W - cell * 4 - 76, (H - cell * 4) // 2
    # 盘底
    d.rounded_rectangle((bx - 26, by - 26, bx + cell * 4 + 25, by + cell * 4 + 25), radius=22,
                        fill=pal['surface'] + (255,), outline=pal['line'] + (255,), width=2)
    d2 = draw_board(img, boxes, pal, bx, by, cell, max(3, int(cell * 0.10)))
    draw_markers(d2, boxes, pal, bx, by, cell)
    # 压边竖条必须在文字之前落笔：晚一笔画上去就会切掉每行首字
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((76, 92, 84, 468), radius=4, fill=hexs(pal['accent_edge']))
    f1, fn1 = load_font(72)
    f2, fn2 = load_font(34)
    f3, _ = load_font(23)
    d.text((112, 84), '畳バリ', font=f1, fill=hexs(pal['ink']))
    d.text((114, 186), 'Tatamibari', font=f2, fill=hexs(pal['accent']))
    lines = ['墙把棋盘切成长方形块，每块恰好一个记号：',
             '「-」宽 > 高 ·「|」高 > 宽 ·「+」正方形',
             '任何一个格点上不许四块共角 · 零猜测',
             '每盘由穷举计数器证明恰好一个解']
    for i, s in enumerate(lines):
        d.text((114, 268 + i * 44), s, font=f3, fill=hexs(pal['ink_dim']))
    return img, {'font_title': fn1, 'font_sub': fn2}


def ui_glyph(kind, pal):
    size = UI_GLYPH
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = hexs(pal['ink'])
    acc = hexs(pal['accent'])
    warn = hexs(pal['hint'])
    lw = 6
    if kind in ('sound-on', 'sound-off'):
        d.polygon([(18, 38), (34, 38), (48, 24), (48, 72), (34, 58), (18, 58)], fill=ink)
        if kind == 'sound-on':
            for r, a in ((58, 22), (70, 14)):
                d.arc((size - r - 22, size - r - 22, size - 22 + r, size - 22 + r), -45, 45, fill=acc, width=lw)
        else:
            d.line((62, 34, 82, 62), fill=warn, width=lw)
            d.line((82, 34, 62, 62), fill=warn, width=lw)
    elif kind == 'pause':
        d.rectangle((28, 22, 42, 74), fill=ink)
        d.rectangle((54, 22, 68, 74), fill=ink)
    elif kind == 'resume':
        d.polygon([(30, 20), (78, 50), (30, 80)], fill=acc)
    elif kind == 'restart':
        d.arc((20, 20, 76, 76), 300, 200, fill=ink, width=lw)
        d.polygon([(74, 16), (82, 34), (62, 32)], fill=ink)
    elif kind == 'fullscreen':
        for (x0, y0, sx, sy) in ((18, 18, 1, 1), (78, 18, -1, 1), (18, 78, 1, -1), (78, 78, -1, -1)):
            d.line((x0, y0, x0 + 20 * sx, y0), fill=ink, width=lw)
            d.line((x0, y0, x0, y0 + 20 * sy), fill=ink, width=lw)
    elif kind == 'motion':
        d.line((18, 30, 78, 30), fill=ink, width=4)
        d.line((18, 50, 62, 50), fill=ink, width=4)
        d.line((18, 70, 78, 70), fill=warn, width=4)
        d.polygon([(66, 58), (86, 70), (66, 82)], fill=warn)
    else:
        raise SystemExit(f'未知 HUD 字形：{kind}')
    return img


def png(path, img):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'PNG', optimize=True)
    return path


# ---------------------------------------------------------------- 主流程

TARGETS = [
    'icons/icon-1024.png', 'icons/icon-512.png', 'icons/icon-192.png', 'icons/icon-180.png',
    'icons/icon-96.png', 'icons/icon-64.png', 'icons/icon-48.png', 'icons/icon-32.png',
    'icons/icon-16.png', 'icons/icon-maskable-512.png', 'icons/icon-maskable-192.png',
    'icons/apple-touch-icon.png', 'icons/favicon-32.png', 'icons/favicon-16.png',
    'icons/icon-manifest.json',
    'assets/og-cover.png', 'assets/textures/tatami-weave.png',
    'assets/textures/tatami-weave-light.png', 'assets/sprites/dust-burst.png',
    'assets/ui/sound-on.png', 'assets/ui/sound-off.png', 'assets/ui/pause.png',
    'assets/ui/resume.png', 'assets/ui/restart.png', 'assets/ui/fullscreen.png',
    'assets/ui/motion.png',
]


def verify_seam(img, name):
    """可平铺性质实测：左 1/8 与右 1/8 的均差、上/下同式，任一超过 3 个灰阶就炸。"""
    s = img.size[0]
    k = max(1, s // 8)
    g = img.convert('L')
    for a, b, tag in ((g.crop((0, 0, k, s)), g.crop((s - k, 0, s, s)), '左右'),
                      (g.crop((0, 0, s, k)), g.crop((0, s - k, s, s)), '上下')):
        diff = abs(ImageStat.Stat(a).mean[0] - ImageStat.Stat(b).mean[0])
        if diff > 3:
            sys.stderr.write(f'{name} 平铺接缝不合格（{tag} 灰度均差 {diff:.2f}）\n')
            raise SystemExit(6)


def verify_partition(cells, boxes):
    """图标画的那张盘必须过引擎那四条：长方形 / 每块一个记号 / 形状对得上记号 / 无四块共角。"""
    for b in range(len(boxes)):
        n = sum(1 for x in cells if x == b)
        r0, c0, r1, c1, shape = boxes[b]
        if (r1 - r0 + 1) * (c1 - c0 + 1) != n:
            raise SystemExit(f'块 {b} 不是长方形')
        if classify(c1 - c0 + 1, r1 - r0 + 1) != shape:
            raise SystemExit(f'块 {b} 记号与形状不符')
    for r in (1, 2, 3):
        for c in (1, 2, 3):
            around = {cells[(r - 1) * 4 + c - 1], cells[(r - 1) * 4 + c],
                      cells[r * 4 + c - 1], cells[r * 4 + c]}
            if len(around) >= 4:
                raise SystemExit(f'格点 ({r},{c}) 四块共角——引擎会判非法')
    kinds = [b[4] for b in boxes]
    if any(kinds.count(s) < 2 for s in ('h', 'v', 's')):
        raise SystemExit('三种记号没各占两块以上，图标会少说一条规则')


def build():
    pal = read_colors()
    cells, boxes = blocks_4x4()
    verify_partition(cells, boxes)
    written = {}

    full = master(1024, pal, boxes, 'full')
    compact = master(64, pal, boxes, 'compact')
    png(os.path.join(REPO, 'icons/icon-1024.png'), full)
    for s in ICONS:
        if s == 1024:
            continue
        src = compact.resize((s, s), Image.LANCZOS) if s <= 32 else full.resize((s, s), Image.LANCZOS)
        png(os.path.join(REPO, f'icons/icon-{s}.png'), src)
    png(os.path.join(REPO, 'icons/apple-touch-icon.png'), full.resize((180, 180), Image.LANCZOS))
    png(os.path.join(REPO, 'icons/favicon-32.png'), compact.resize((32, 32), Image.LANCZOS))
    png(os.path.join(REPO, 'icons/favicon-16.png'), compact.resize((16, 16), Image.LANCZOS))
    for s in (512, 192):
        png(os.path.join(REPO, f'icons/icon-maskable-{s}.png'),
            maskable(full.resize((s, s), Image.LANCZOS), s, pal['bg']))

    tex = tile_weave(TEXTURE, pal['surface'], (pal['ink'][0], pal['ink'][1], pal['ink'][2], 16))
    verify_seam(tex, 'tatami-weave')
    png(os.path.join(REPO, 'assets/textures/tatami-weave.png'), tex)
    texl = tile_weave(TEXTURE, (255, 255, 255), (16, 25, 34, 14))
    verify_seam(texl, 'tatami-weave-light')
    png(os.path.join(REPO, 'assets/textures/tatami-weave-light.png'), texl)

    # 粒子 sprite：中心到边缘的软衰减，四边必须全透明（平铺与加法混合都不出硬边）
    S = 64
    spr = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ps = spr.load()
    for yy in range(S):
        for xx in range(S):
            dx, dy = (xx - S / 2 + 0.5) / (S / 2), (yy - S / 2 + 0.5) / (S / 2)
            r = math.hypot(dx, dy)
            a = max(0.0, 1.0 - r) ** 2
            ps[xx, yy] = (255, 255, 255, int(a * 255))
    png(os.path.join(REPO, 'assets/sprites/dust-burst.png'), spr)

    cover, fonts = og_cover(pal, boxes)
    png(os.path.join(REPO, 'assets/og-cover.png'), cover)

    for kind in ('sound-on', 'sound-off', 'pause', 'resume', 'restart', 'fullscreen', 'motion'):
        png(os.path.join(REPO, f'assets/ui/{kind}.png'), ui_glyph(kind, pal))

    for rel in TARGETS:
        if not rel.endswith('.png'):
            continue
        p = os.path.join(REPO, rel)
        if not os.path.exists(p):
            raise SystemExit(f'产出清单里承诺的文件没落盘：{rel}')
        if os.path.getsize(p) == 0:
            raise SystemExit(f'{rel} 是 0 字节')
        w, h = Image.open(p).size
        written[rel] = {'w': w, 'h': h, 'bytes': os.path.getsize(p)}

    manifest = {
        'repo': os.path.basename(REPO),
        'motif': 'tatami-4x4-solution',
        'palette': {k: hexs(v) for k, v in pal.items()},
        'partition': {
            'cells': cells,
            'boxes': [{'r0': b[0], 'c0': b[1], 'r1': b[2], 'c1': b[3], 'shape': b[4],
                       'marker': MARK[b[4]]} for b in boxes],
            'verified': ['每块长方形', '每块恰好一个记号', '记号与形状一致', '无四块共角', '三种形状齐全'],
        },
        'fonts': fonts,
        'files': written,
    }
    with open(os.path.join(REPO, 'icons', 'icon-manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
        f.write('\n')
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--list', action='store_true', help='只列将产出的文件')
    a = ap.parse_args()
    if a.list:
        print('\n'.join(TARGETS))
        return 0
    m = build()
    print(f"母题 {m['motif']} · 块 {len(m['partition']['boxes'])} · "
          f"记号 {''.join(b['marker'] for b in m['partition']['boxes'])}")
    for rel, v in sorted(m['files'].items()):
        print(f'  {rel:44s} {v["w"]}x{v["h"]}  {v["bytes"]}B')
    return 0


if __name__ == '__main__':
    sys.exit(main())
