#!/usr/bin/env bash
# 第五道闸（浏览器闸）：真 headless Chrome、真 DOM、真画布像素、真 localStorage —— 两种 URL 形态各跑一遍：
#
#   ① root    http://127.0.0.1:5316/                                 (server.cjs：仓库自己就是文档根)
#   ② prefix  http://127.0.0.1:5399/z-biz-game-tatamibari-cos/       (the GitHub Pages shape of
#                                                                     https://z-biz-game.github.io/z-biz-game-tatamibari-cos/)
#
#   bash tools/verify.sh                       # 两种形态、全部场景
#   SHAPES=root bash tools/verify.sh           # 改东西时先只跑一种
#   SCENARIOS="first play" bash tools/verify.sh
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-tatamibari-cos/ bash tools/verify.sh
#                                              # 部署件：只跑这一种形态，本脚本不起任何服务
#
# 为什么前缀形态必须单跑一遍而不是写进脚注：根形态是唯一一种能被本地服务器"蒙对"的形态。
# 页面级 `/js/...` 说明符在仓库=文档根时解得开，挂在 /<repo>/ 下就 404；而抛出来的 dynamic import
# 会把整段注入脚本一起带沉，于是部署站点静默地只跑了一小部分断言。只看根形态的闸分不清这两种情况。
# tools/scenarios.js 里那个 mod() 特意按 document.baseURI 解析（import(new URL(rel, baseURI))），
# 就是因为这个 —— 只有前缀那一跑能看见它到底解没解错。
#
# 端口是这一仓的，不是家族的公共汽车：5316（HTTP）/ 9366（CDP）见 tools/playtest.cjs:33-34，
# 前缀形态用 5399 —— 见 tools/playtest.cjs:17（5392 tapa、5396 kakuro、5397 kenken、5398 nurikabe 已占用）。
# 换端口要同时改那两处的注释，否则下一个人抄到的是一张已经被别人坐下的桌子。
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates every core and, with no CDP client attached, Chrome will not exit
# on its own. Canvas pixels are half the point of this file — a fake rasteriser makes them lie.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(basename "$HERE")                     # the Pages path segment, same as the repo slug
FEATURE=畳バリ                                # this app's own word: proof the bytes are ours
CDP_WANT=${CDP_PORT:-9366}
HTTP_WANT=${HTTP_PORT:-5316}
PREF_WANT=${PREFIX_PORT:-5399}
CHROME=${CHROME_BIN:-}
# tools/scenarios.js 末尾 w.__scn 里已注册的场景。顺序有讲究：
#   save→resume 是一对**跨刷新**的戏 —— playtest.cjs 每个场景都重新注入并 navigate 一次，
#   后一段读的是磁盘上的存档而不是内存里的残骸，所以这两段之间不许插别的场景；
#   narrow 那一段逐字断言视口，必须拿自己的 VIEWPORT 跑（见下面那两行 VP_）。
SCENARIOS_DONE="first play undo hint clash win save resume layout narrow"
# narrow 那条场景断言 `${innerWidth},${innerHeight}` === '390,844'（tools/scenarios.js 里 narrow 的第一行），
# 靠的是 playtest.cjs 的 VIEWPORT —— 它在第一次导航**之前**下 Emulation.setDeviceMetricsOverride。
# 每一段都显式带上视口，包括默认那一档：override 挂在 target 上，不清就等于留给下一段，
# 于是 SCENARIOS="narrow first" 这种手工顺序会拿着一张 390px 的盘去断言 1280px 的几何。
VP_DEFAULT=${VIEWPORT_DEFAULT:-1280x1024}
VP_NARROW=${VIEWPORT_NARROW:-390x844}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
command -v python3 >/dev/null 2>&1 || { echo "需要 python3（前缀形态的静态服务器 + 结果解析）" >&2; exit 2; }
{ command -v "$CHROME" >/dev/null 2>&1 || [ -x "$CHROME" ]; } || {
  echo "no Chrome found — 试过的路径：" >&2
  echo "  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >&2
  echo "  /Applications/Chromium.app/Contents/MacOS/Chromium" >&2
  echo "  google-chrome / chromium / chromium-browser (PATH)" >&2
  echo "  或者 CHROME_BIN=/path/to/chrome bash tools/verify.sh" >&2
  exit 2; }

# 日志与夹具落点：不写 /tmp —— 这一台机器上有别的 agent 同时在跑 Chrome，/tmp 里的前缀文件名
# 会互相踩；而且工具链会在会话中途清 /tmp，一份消失的日志会被读成一次"没有断言"的假绿。
# 默认落在 $TMPDIR（macOS 上是每用户私有的 /var/folders/...，Linux runner 上退到 /tmp），
# 手工跑的时候用 VERIFY_LOG_DIR= 指到工作区里那堆 _tmp-tatami-* 旁边，方便逐条引用。
LOGDIR=${VERIFY_LOG_DIR:-"${TMPDIR:-/tmp}/tatamibari-verify"}
mkdir -p "$LOGDIR" || { echo "日志目录 $LOGDIR 建不起来" >&2; exit 2; }
rm -f "$LOGDIR"/root-*.tally "$LOGDIR"/prefix-*.tally "$LOGDIR"/custom-*.tally 2>/dev/null

# ---- ports ---------------------------------------------------------------------------------------
# 5316 / 5399 / 9366 belong to tatamibari and to nothing else in the family. A long-lived server on
# one of them happily serves a *different* app — or this same app out of an orphaned checkout, which
# a content pre-flight cannot always catch. So: never borrow a bound socket, take the next free one
# and say out loud which one was taken by whom. Nothing here kills a process it did not start:
# 这台机器上此刻 5316 与 9366 就坐着上一轮留下的两个孤儿进程，一个都不许碰 —— 闸会自动换到
# 5416 / 9466（以及 5499），并把"谁在听这一口"打出来。
occupied() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }
squatters() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' '; }
first_free() {
  local base=$1 p
  for p in "$base" $((base + 100)) $((base + 200)) $((base + 300)); do
    if occupied "$p"; then
      echo "  端口 $p 已被别的进程听着（pid: $(squatters "$p")）——不借它的 socket，换下一个" >&2
    else
      echo "$p"; return 0
    fi
  done
  return 1
}

CUSTOM=0
[ -n "${BASE_URL:-}" ] && CUSTOM=1

if [ "$CUSTOM" = 0 ]; then
  CDP=$(first_free "$CDP_WANT") || { echo "no free devtools port near $CDP_WANT" >&2; exit 2; }
  HTTP=$(first_free "$HTTP_WANT") || { echo "no free http port near $HTTP_WANT" >&2; exit 2; }
  PREF=$(first_free "$PREF_WANT") || { echo "no free http port near $PREF_WANT" >&2; exit 2; }
  echo "ports: CDP $CDP (want $CDP_WANT) · root http $HTTP (want $HTTP_WANT) · prefix http $PREF (want $PREF_WANT)"
  echo "  两种形态各用一个端口：origin 不同 → localStorage 各一套，前缀那一跑才是"换了文档目录"，不是"重装一遍""
else
  CDP=${CDP_PORT:-9366}
  echo "BASE_URL given → 只跑部署件这一种形态，本脚本不起任何服务（CDP $CDP）"
fi
echo "logs: $LOGDIR"

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$CDP --user-data-dir=$UDD \
  --window-size=1280,1024 --no-first-run --no-default-browser-check about:blank \
  >"$LOGDIR/chrome.log" 2>&1 &
CPID=$!
SPID=0
PSPID=0
PROOT=""
cleanup() {
  # 只杀自己起的那三个 pid。别的 agent 的 Chrome / 服务器一律不动。
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$PSPID" != 0 ] && kill $PSPID 2>/dev/null
  kill -9 $CPID 2>/dev/null
  [ -n "$PROOT" ] && rm -rf "$PROOT"
  return 0
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits this script's stdout, and
# inside a pipeline it would hold the write end open long after the tests finished.
( sleep ${WD_TIMEOUT:-1500}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
for i in $(seq 1 120); do
  curl -fsS -m 1 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$CDP (see $LOGDIR/chrome.log)" >&2; exit 3; }

cd "$HERE"

FAILED=0
# 该交回几段结果，是注册表决定的，不是"跑完了就算"决定的。
WANT_N=$(echo ${SCENARIOS:-$SCENARIOS_DONE} | wc -w | tr -d ' ')

# ---- the node side of the seed fixture -----------------------------------------------------------
# tools/scenarios.js 里 >>>FIXTURE…<<<FIXTURE 那一段是**从 node 出货的**盘面指纹（尺寸 / 记号盘 /
# 难度分 / 铅笔轮数 / 逐条提示序列 / 唯一性读数 / 存档 RLE / 手势表重放出来的那些数）。Chrome 那一侧
# 逐字段复现它们；但如果 node 这一侧已经不再产出同样的指纹，这份"逐字段一致"就是在跟自己的上一版对表。
# 所以每次运行都从页面 import 的同一批模块（js/ui/game.js + js/engine/generate.js + js/store.js）把
# 整段重算一遍并逐字段比：夹具是 node 的出货，不是 Chrome 的。
# save* 那几列还要多走一步：把页内用的那串手势（saveOps）在这里用 Game 的 API 重放一遍，
# 期望的是"真指针画出来的 ink"与"API 重放出来的 ink"是同一份 RLE —— 两条路只有一条对的时候，
# 断言等于没测。
# 取最后一次 // >>>FIXTURE：文件头的散文里也写着这个串，第一次命中的是那句话。
echo "=== node re-derives the seed fixture pinned in tools/scenarios.js ==="
node --input-type=module --no-warnings -e "$(cat <<'NODEFIX'
import { readFileSync } from 'node:fs';
import { makePuzzle, Game } from './js/ui/game.js';
import { rle } from './js/store.js';
import { TIERS } from './js/engine/generate.js';

const src = readFileSync('tools/scenarios.js', 'utf8');
const at = src.lastIndexOf('// >>>FIXTURE');
const end = src.indexOf('// <<<FIXTURE', at);
if (at < 0 || end < 0) {
  console.log('  scenarios.js 里没有 // >>>FIXTURE … // <<<FIXTURE 这一段：跨引擎那一钉没东西可对');
  process.exit(1);
}
const body = src.slice(at, end);
// 夹具是 JS 对象字面量，不是 JSON：这一段是本仓自己的受信源码，直接 eval。
const want = eval(body.slice(body.indexOf('['), body.lastIndexOf(']') + 1));
if (!Array.isArray(want) || !want.length) {
  console.log('  FIXTURE 解析出来是空的：0 行的夹具钉不住任何东西');
  process.exit(1);
}

// 与 tools/scenarios.js 里 save 那一段同一套语义：t:=点一下、d:=一笔拖、h:=按一下提示按钮。
const runOps = (g, ops) => {
  for (const tok of ops.split(' ')) {
    if (tok === 'h') { g.hint(); continue; }
    if (tok.startsWith('t:')) {
      const [, i, dir, val] = tok.split(':');
      g.mode = Number(val);
      g.tap(Number(i), Number(dir), Number(val));
      continue;
    }
    if (tok.startsWith('d:')) {
      const [segList, val] = tok.slice(2).split(':');
      g.mode = Number(val);
      g.stroke(segList.split(',').map((s) => {
        const [i, dir] = s.split('/');
        return { i: Number(i), dir: Number(dir) };
      }), Number(val));
    }
  }
};

let bad = 0;
for (const row of want) {
  const made = makePuzzle(row.origin, row.tier);
  const puzzle = made && made.puzzle;
  if (!puzzle) {
    bad++;
    console.log(`  FAIL ${row.origin}: node 这一侧出不了盘（tries=${made && made.tries}）—— 浏览器里的期望值已无源可追`);
    continue;
  }
  const g = new Game(puzzle);
  const tier = TIERS.find((t) => t.key === row.tier) || {};
  const got = {
    seed: made.seedUsed,
    tries: made.tries,
    tier: puzzle.tierKey,
    tierName: tier.name,
    band: (tier.band || []).join(','),
    w: g.w,
    h: g.h,
    edges: g.edges.length,
    score: puzzle.score,
    passes: puzzle.passes,
    steps: puzzle.steps,
    maxBlock: puzzle.maxBlock,
    grid: puzzle.grid.join('/'),
    markers: g.markers.map((m) => `${m.r},${m.c},${m.type}`).join(' '),
    sols: g.uniqueness.sols,
    nodes: g.uniqueness.nodes,
    agree: String(g.channelsAgree),
    scriptLen: g.script.length,
    // 规则名里带一个空格（"R1 记号互斥"），所以夹具里绝不能用空格当分隔符：一条事实会被劈成两半。
    script: g.script.map((f) => `${f.rule}|${f.i}|${f.dir}|${f.want}`).join('; '),
    freeWalls: g.freeWalls.map((f) => `${f.rule}|${f.i}|${f.dir}|${f.want}`).join('; '),
    wallsWant: g.script.filter((f) => f.want === 1).length,
    mergedWant: g.script.filter((f) => f.want === 2).length,
  };
  if (row.saveOps) {
    const gs = new Game(puzzle);
    runOps(gs, row.saveOps);
    const ink = gs.ink();
    Object.assign(got, {
      saveOps: row.saveOps,
      saveMoves: gs.moves,
      saveHints: gs.hints,
      saveDecided: gs.edges.length - gs.unknown,
      saveUnknown: gs.unknown,
      saveWalls: gs.walls,
      saveMerged: gs.merged,
      saveRegions: gs.groups.length,
      saveClashes: gs.contradictions.length,
      saveStatus: gs.status,
      saveRleRight: rle(ink.right),
      saveRleDown: rle(ink.down),
    });
  }
  if (row.undoCursorProbe) {
    const gu = new Game(puzzle);
    const h1 = gu.hint();
    gu.undo();
    const r = gu.solveWithLogic();
    got.undoCursorProbe = `${h1.i}/${h1.dir} cursor=${gu.cursor} status=${r.status} unknown=${gu.unknown} hints=${gu.hints}`;
  }
  const keys = Object.keys(got).filter((k) => row[k] !== undefined);
  const diff = keys.filter((k) => String(got[k]) !== String(row[k]));
  if (diff.length) {
    bad++;
    console.log(`  FAIL ${row.origin} node 重算与夹具不符: ${diff.map((k) => `${k} ${row[k]}→${got[k]}`).join(' / ')}`);
  }
}
console.log(`  ${want.length - bad}/${want.length} 条 seed 指纹（含手势表重放与 RLE）仍由 node 原样重算出来`);
process.exit(bad ? 1 : 0);
NODEFIX
)" || FAILED=1

# ---- the machine-readable RESULT line ------------------------------------------------------------
# playtest.cjs 把 RESULT 打在 stdout 的最后一行、console 噪音留在 stderr。这里不数行数就
# 不叫跑过：一条断言都没发生的场景（页面启动失败、import 404、场景被改名）会以"0 failed"
# 的样子绿过去，所以空 rows / 解析不出来 / 拿不到 RESULT 一律 exit 1，并把条数写进 tally
# 让上面那一层去核对"该报 10 段是不是只报了 9 段"。
PARSE=$(cat <<'PARSER'
import sys, json
shape, scn, tally, clog = sys.argv[1:5]
raw = sys.stdin.read().strip()
# playtest.cjs:186 那一行的前缀是协议的一部分，摘掉才是 JSON。
if raw.startswith('RESULT '):
    raw = raw[len('RESULT '):]
if not raw:
    print('  NO RESULT —— playtest.cjs 什么都没回（见 %s）' % clog); sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
rows = d.get('rows')
if rows is None:
    print('  NO RESULT FIELD —— 回的东西不是闸的口径:', str(d)[:300]); sys.exit(1)
if not rows:
    print('  NO CHECKS RUN —— 一条都不断言的场景没有资格是绿的'); sys.exit(1)
for r in rows:
    if not r['pass']:
        print('  FAIL %-56s %s' % (r['test'], r['detail']))
fail = int(d.get('fail', 0))
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
with open(tally, 'w') as f:
    f.write('%d %d\n' % (len(rows), fail))
print('  %d checks, %d failed  %s' % (len(rows), fail, extra if extra else ''))
sys.exit(1 if fail else 0)
PARSER
)

# ---- pre-flight: the bytes about to be tested are 畳バリ itself -----------------------------------
# A server on the wrong port serving *some* index.html is the failure this gate exists to catch,
# and "the page loaded" is not enough: a static host that answers 200 with the shell for every
# path (SPA fallback, a directory listing, an orphan checkout) still lets the scenario run — it
# just lets it run against fewer files. So each module path is asserted to come back 200 *and*
# with exactly the byte count that is on disk. A missing file must be loud and early, never a
# quietly reduced assertion count.
PREFLIGHT_RELS="js/main.js js/ui/game.js js/engine/generate.js js/engine/pencil.js js/render/board.js js/store.js css/game.css"
preflight() {
  local base=$1 rel want got f
  local served
  served=$(curl -fsS -m 8 "$base" 2>/dev/null) || { echo "  首页取不到：$base" >&2; return 1; }
  case "$served" in *js/main.js*) ;; *) echo "  $base 上发的不是本仓的首页（正文里找不到 js/main.js）" >&2; return 1 ;; esac
  case "$served" in *"$FEATURE"*) ;; *) echo "  $base 在发别的应用：首页正文里找不到「$FEATURE」" >&2; return 1 ;; esac
  for rel in $PREFLIGHT_RELS; do
    want=$(wc -c < "$HERE/$rel" | tr -d ' ')
    [ -n "$want" ] || { echo "  $rel 在磁盘上读不到，闸没有可对的基准" >&2; return 1; }
    f="$LOGDIR/preflight-$(echo "$rel" | tr '/' '_')"
    got=$(curl -sS -m 8 -o "$f" -w '%{http_code} %{size_download}' "$base$rel" 2>/dev/null) || {
      echo "  $rel 取不回来：$base$rel" >&2; return 1; }
    case "$got" in "200 $want") ;; *)
      echo "  $rel 不对味：$base$rel 回 $got，磁盘上的这份是 200 $want 字节" >&2
      echo "  前两行到手内容：$(head -c 160 "$f" | tr '\n' ' ')" >&2
      return 1 ;; esac
  done
  echo "  预检：首页含「$FEATURE」与 js/main.js · $(echo $PREFLIGHT_RELS | wc -w | tr -d ' ') 条真实模块路径按字节对上磁盘（main / ui/game / engine/generate / engine/pencil / render/board / store / css/game）"
  return 0
}

# ---- one shape -----------------------------------------------------------------------------------
run_shape() {
  local shape=$1
  local base s vp tally clog
  local n m reported=0 checks=0 fails=0 bad=0
  local t0 t1
  t0=$SECONDS
  SPID=0
  PSPID=0
  PROOT=""
  if [ "$CUSTOM" = 1 ]; then
    base=$BASE_URL
  elif [ "$shape" = root ]; then
    base="http://127.0.0.1:$HTTP/"
    node "$HERE/server.cjs" "$HTTP" >"$LOGDIR/$shape-server.log" 2>&1 &
    SPID=$!
  else
    # Pages shape: the repo lives under one path segment, served by a static file server whose root
    # is a directory that only *contains* a symlink to it. Nothing is copied or rewritten — that is
    # the point: a hard-coded `/js/...` has nowhere to hide in that shape.
    base="http://127.0.0.1:$PREF/$REPO/"
    PROOT=$(mktemp -d)
    ln -s "$HERE" "$PROOT/$REPO" || { echo "软链 $PROOT/$REPO 建不起来" >&2; return 1; }
    python3 -m http.server "$PREF" --bind 127.0.0.1 --directory "$PROOT" >"$LOGDIR/$shape-server.log" 2>&1 &
    PSPID=$!
  fi
  BASE=$base
  if [ "$CUSTOM" = 0 ]; then
    for i in $(seq 1 40); do
      curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break
      sleep 0.25
    done
  fi
  echo
  echo "################ shape=$shape  base=$BASE  (CDP :$CDP)"
  preflight "$BASE" || return 2

  export CDP_PORT=$CDP
  export BASE_URL=$BASE
  VIEWPORT=$VP_DEFAULT node tools/playtest.cjs open "$BASE" | head -5

  local boot=""
  for i in $(seq 1 60); do
    boot=$(VIEWPORT=$VP_DEFAULT node tools/playtest.cjs eval "window.tatamibari?window.tatamibari.version:'nope'" nonav 2>/dev/null | tr -d '\n" ')
    case "$boot" in *nope*|"") sleep 0.5 ;; *) break ;; esac
  done
  echo "boot: tatamibari $boot at $BASE"
  if [ "$boot" = "nope" ] || [ -z "$boot" ]; then echo "window.tatamibari never appeared at $BASE" >&2; return 4; fi

  # 默认跑已注册的那一组（每往 tools/scenarios.js 里加一组场景就把名字加进 SCENARIOS_DONE）：
  # `bash tools/verify.sh` 在任何一次提交上都必须是绿的，所以还没写完的名字不放进默认列表，
  # 只放 SCENARIOS= 里手工跑。
  for s in ${SCENARIOS:-$SCENARIOS_DONE}; do
    vp=$VP_DEFAULT
    [ "$s" = narrow ] && vp=$VP_NARROW
    tally="$LOGDIR/$shape-$s.tally"
    clog="$LOGDIR/$shape-$s.console.log"
    rm -f "$tally"
    echo "=== [$shape] $s (viewport $vp) ==="
    VIEWPORT=$vp node tools/playtest.cjs scenario "$s" 2>"$clog" | tail -1 \
      | python3 -c "$PARSE" "$shape" "$s" "$tally" "$clog" || bad=1
    if [ -s "$tally" ]; then
      read -r n m < "$tally"
      reported=$((reported + 1))
      checks=$((checks + n))
      fails=$((fails + m))
    else
      bad=1
      echo "  没有 tally：$s 这一跑连条数都没交出来，不能算跑过"
    fi
    if [ -s "$clog" ]; then
      echo "  --- console (tail 12) $clog ---"
      sed 's/^/  /' "$clog" | tail -12
    fi
  done

  t1=$((SECONDS - t0))
  echo "---- shape=$shape 汇总: $reported/$WANT_N scenarios reported · $checks checks · $fails failed · ${t1}s ----"
  if [ "$reported" != "$WANT_N" ]; then
    echo "  少了一段场景交回结果：注册表要 $WANT_N 段，只收到 $reported 段 —— 悄悄少跑不能算绿" >&2
    bad=1
  fi
  [ "$bad" = 0 ] || FAILED=1
  return $bad
}

SHAPE_LIST="root prefix"
[ "$CUSTOM" = 1 ] && SHAPE_LIST=custom
RAN=""
for shape in ${SHAPES:-$SHAPE_LIST}; do
  RAN="$RAN $shape"
  run_shape "$shape" || FAILED=1
  # each shape gets its own servers; tear this one down before the next
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  [ "$PSPID" != 0 ] && kill $PSPID 2>/dev/null
  [ -n "$PROOT" ] && rm -rf "$PROOT"
  SPID=0
  PSPID=0
  PROOT=""
done

kill $WD 2>/dev/null
# 只报这一跑真的跑过的形态：SHAPES=root / BASE_URL= 那种单形态跑，旧文案照样打印"两种 URL 形态"。
[ $FAILED -eq 0 ] && echo "=== ALL GREEN（这一跑实际覆盖的 URL 形态：${RAN# }）===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
