# 畳バリ - 交付报告

## 0. 基线 → 本次提交

| | |
|---|---|
| 仓 | `z-biz-game-tatamibari-cos`（本仓自己的名字是「畳バリ Tatamibari」，见 `index.html:7`） |
| 基线 | `80a676f`（"Merge branch 'main' of github.com:z-biz-game/z-biz-game-tatamibari-cos"） |
| 修复提交 | `e5d7c97`（"fix(tatamibari): 补回被并线吃掉的 onDown，暂停只留一套，重复 id 与重复接线各收一份"） |
| 交付物提交 | 本文件所在的那一次提交 |
| 基线状态 | **整局不可玩**：`js/main.js` 是 SyntaxError，ES module 根本不加载 ⇒ 页面一片空白；闸一条也跑不起来 |
| 修完状态 | 语法门 OK；node 侧 65 + 74 + 206 + 18 条断言 0 失败；浏览器闸 root 与 prefix 两种形态各 11 场景 393 条 0 失败；部署集 42 条引用 / 61 行 0 失败；部署集自检 rc=0 |

### 整局不可玩的根因（三条，都在 `js/main.js`，互相遮住）

V8 先报撞名、再报缺括号，所以只看到第一条；第二条要等第一条被拿掉才露出来。

1. **同名顶层声明 `let paused` 声明了两次。**
   早先那套暂停用 `baseMs` / `startedAt`（`clock() = startedAt ? baseMs + (now - startedAt) : baseMs`），
   后一套改用 `runMs` / `runFrom`（累计值 + 正在跑的那一段的起点，`js/main.js:89`）。
   两套各留一份 `let paused` ⇒ `SyntaxError: Identifier 'paused' has already been declared`
   ⇒ 模块不加载 ⇒ 整局打不开。旧那套还引用了 `baseMs` / `startedAt` 这两个**根本没声明过**的变量。

2. **`pointerdown` 那段内联残骸少了 `addEventListener` 的收尾括号。**
   手势被重构成 `onDown` / `onMove` / `onUp` 三件套（指针、touch 回退、鼠标回退汇到同一条路径），
   重构时 **`onDown` 整个被漏掉**，只留下内联在 `addEventListener` 里的那段残骸；
   它的收尾只有 `}` 没有 `)` ⇒ `SyntaxError: missing ) after argument list`。
   残骸里还写着 `showPreview(hit, clientX, clientY)`，而 `clientX` / `clientY` 早就不在这个作用域里了。

3. **导出面上的 `setPaused` 指向一个不存在的函数。**
   旧那套 `setPaused` 被删掉之后，导出对象里还留着 `setPaused,` ⇒ 模块求值时直接 ReferenceError。
   即使前两条修好，这一行也会让整仓再挂一次。

> 判据不是时间戳，是「哪一侧是完整产品」+「本仓的闸怎么写」。
> 远端侧（`80a676f^2`，907 行）语法通过、手势只有一套、暂停只有一套；本地侧（`80a676f^1`，1369 行）
> 是上一次有机并线的产物，能力强但带着上面三条。于是**冲突处以闸为准**（`tools/scenarios.js` 钉着
> `.hud-right button` 的名册、暂停的冻结读数、全屏的进出场），**不冲突的增量留着**（`runMs/runFrom`
> 的真冻结时钟、触摸与鼠标回退、暂停遮罩与 `applyPause` 的那套接口）。

## 1. 改动表：旧代码错在哪 → 新代码为什么对

| # | 旧代码错在哪 | 新代码为什么对 |
|---|---|---|
| 1 | 两套暂停机制并存，各留一份 `let paused`；旧那套还引用没声明过的 `baseMs` / `startedAt` | 删掉旧那套（`setPaused` / `paintPause` 及其注释），只留 `runMs` / `runFrom`；`applyPause` 是唯一的暂停入口（`js/main.js:231`） |
| 2 | 导出面写 `setPaused,`，可这个名字背后的实现已经没了 | 导出名保留（闸读的就是这张脸），实现指向 `applyPause`（`js/main.js:1243`） |
| 3 | 手势重构时 `onDown` 被漏掉，只剩一段少 `)` 的内联残骸 | 补回 `onDown(clientX, clientY, pointerId)`（`js/main.js:795`），落笔那几步与重构前逐句一致，签名对齐 `onMove` / `onUp` |
| 4 | 旧机制有一处独有行为：暂停时把**拖到一半的那一笔**作废 | 这条不许丢：作废逻辑搬进 `applyPause`（`drag = null; hidePreview(); paint();`） |
| 5 | `#btn-pause` 在工具条与 HUD 右上角**各有一个**：同一 id ⇒ `getElementById` 只认得先出现的那颗（工具条那颗），HUD 那颗成了死按钮；闸读 HUD 那颗，读到的是永远写着「暂停」的静态文案 | 暂停那颗只留在 HUD 右上角（`index.html:106`），图标与 `#pause-label` 一起搬过去；工具条那颗删掉，闸钉的名册（`btn-pause,btn-fullscreen`）与 `.toolbar` 名册都对上了 |
| 6 | `#btn-fullscreen` 同样有两个（顶栏图标钮 + HUD 那颗） | 顶栏那颗保留位置、改 id 为 `btn-fullscreen-top`（`index.html:30`），HUD 那颗仍是 `btn-fullscreen`（`index.html:107`）；两处一起接到同一份实现（`js/main.js:1284`） |
| 7 | 两套全屏实现：本地 `toggleFullscreen` + 远端 `bindFullscreen` IIFE，**两处都绑了同一颗按钮、也都处理了 F 键** ⇒ 一次点击进出各一次，净效果是「什么都没发生」 | 只留 `bindFullscreen` 一份（它才有能力探测、失败不禁用、文案回写）；本地那套连同它的 `syncFullscreenLabel` 一起删掉，F 键与点击都只进出一次 |
| 8 | 全屏按钮的文案从不改：本地那套只更新 `aria-pressed` / `aria-label`，闸要的是文案在「全屏」与「退出全屏」之间改口 | `sync()` 随 `fullscreenchange` 回写文案与 `aria-pressed`；顶栏那颗是图标钮（本来没有文字），只更 `aria-label`，不往里塞文字把图标挤歪 |
| 9 | 暂停键被绑了两次（`el.btnPause` 一条 + 一段 `bindPause` IIFE 一条）⇒ 一次点击切两次，净零 | 删掉那段 IIFE（它调的还是已经不存在的 `setPaused`），只留一条 |
| 10 | 暂停中按 Esc 会**先恢复**（`if (paused) applyPause(false)`），与闸的合同（Esc 只回选档、这一盘仍停在暂停态）和代码自己那句注释（Escape 放行是因为它不改盘面）都相反 | Esc 改成「回选档但仍停在暂停态」（`js/main.js:1008`）；重新开局时 `adopt()` 会把暂停态清掉 |
| 11 | service worker 注册了两遍：`index.html` 挂 `js/sw-register.js`，而 `js/main.js` 里 `registerServiceWorker()` 又注册一次 | 只由 `js/main.js` 注册（它认 `file://`、还把状态挂在导出面上），`js/sw-register.js` 与它的 script 标签一起删 |
| 12 | 文档里的行号钉漂了 19 处（`doctest` 抓得住的 2 条红，其余是它抓不到的静默漂） | 逐条重钉到当前代码上（详见第 3 节） |
| 13 | 部署集闸钉的实数（35 条引用 / 54 行断言）早就是旧的：并线后实数已是 43 / 62 ⇒ **那道闸在基线上就是红的** | 基线时钉的是 35 / 54、实数为 43 / 62；e5d7c97 先更新为 40 / 59，B4d 复修再改为 42 / 61（`tools/deploy-set.mjs:41`、`tools/deploy-set.mjs:45`），并在闸里写明「钉的是实数，强度不变」 |

## 2. 真实文件清单

| 文件 | 改了什么 | 增 / 删 |
|---|---|---|
| `js/main.js` | 整仓不可玩的三条根因 + 重复接线各收一份 + Esc 语义改回 + 暂停时作废拖拽 | +85 / −81 |
| `index.html` | 两处同名 id 收干净、暂停那颗搬进 HUD 右上角、删掉重复的 sw-register 标签 | +6 / −7 |
| `js/sw-register.js` | **整份删除**（重复的 service worker 注册） | −12 |
| `tools/deploy-set.mjs` | 钉的实数 35 / 54 → 40 / 59，附「钉的是实数，强度不变」的说明 | +8 / −2 |
| `tools/doctest.mjs` | 自检里硬编码的 needle 与毒药行号跟着重钉（`tools/doctest.mjs:278`） | +4 / −4 |
| `README.md` | 19 处行号钉重钉 + 浏览器闸读数更新（387 → 393 条、`play` 50 → 56 条） | +23 / −23 |
| `DESIGN.md` | 1 处行号钉重钉 | +1 / −1 |
| `.github/workflows/ci.yml` | 注释里那句本机读数（387 → 393） | +2 / −2 |

合计：8 个文件，+129 / −132。

## 3. 删行审计（逐处：删了什么、为什么删、替代它的是什么）

### 3.1 `js/main.js`

| 删掉 | 为什么 | 替代 |
|---|---|---|
| 旧那套 `let paused` + `setPaused()` + `paintPause()`（含 5 行注释） | 与后一套机制并存 ⇒ 同名顶层声明 ⇒ SyntaxError；它引用的 `baseMs` / `startedAt` 从来没声明过 | `applyPause()`（`js/main.js:231`），冻结的是 `runMs` / `runFrom` |
| `adopt()` 里 `baseMs = …; startedAt = Date.now();` 与 `if (paused) { paused = false; paintPause(); }` | 那两个变量不存在 | `runMs = …; runFrom = 0;` 加 `if (paused) applyPause(false);`（新局一定在走表，按钮与时钟不各说各话） |
| 键盘尾巴那行 `setPaused(!paused);` | 该函数已删，留着就是 ReferenceError | `applyPause(view.name === 'game' ? !paused : false)`（与 P 键同一口径） |
| 那段缺 `)` 的内联 `pointerdown` 残骸（17 行） | 少收尾括号 ⇒ SyntaxError；行为又与重构后的统一路径重复 | `onDown()`（`js/main.js:795`），由 `hasPointerEvents()` 那条统一接线调用 |
| 本地那套 `toggleFullscreen()` + `syncFullscreenLabel()`（21 行） | 与 `bindFullscreen` IIFE 重复接线：按钮被绑两次、F 键被处理两次 | `bindFullscreen` 那一份（并扩成同时接两颗按钮） |
| `el.btnFullscreen.addEventListener(…)` 那 4 行 | 同一颗按钮第二次绑定 | 同上 |
| `window.addEventListener('fullscreenchange', syncFullscreenLabel)` 与 `syncFullscreenLabel();` 那次调用 | 那套只更 `aria-pressed` / `aria-label`，文案从不改口 | `bindFullscreen` 里的 `sync()`（文案 + `aria-pressed` + body 的 `fullscreen` 类一起回写） |
| 键链里的 `else if (k === 'f') toggleFullscreen();` | 那是第二次处理 F 键 | `bindFullscreen` 里的 keydown（带 `ev.repeat` 守卫与输入框焦点守卫） |
| `bindPause` 那段 IIFE（6 行） | 第二次绑同一颗暂停键，且调的是已不存在的 `setPaused` | `el.btnPause` 那一条（`applyPause`） |
| 导出里的 `toggleFullscreen,` 与 `setPaused,` | 名字背后的实现换人了 | `toggleFullscreen: () => (fullscreenToggle ? fullscreenToggle() : false)` 与 `setPaused: applyPause`（`js/main.js:1243`） |

**没有删掉的功能**：暂停真冻结时钟（后一套更强）、暂停遮罩与「继续 / 回选档」两颗按钮、触摸与鼠标
回退、暂停时作废拖拽这一笔、`pause` 这个导出名、`F` 键、顶栏那颗全屏入口。

### 3.2 `js/sw-register.js`（整份 12 行）

它做的事（`file://` 下不注册、用相对 `sw.js` 与 `{ scope: './' }`）`js/main.js` 的
`registerServiceWorker()` 全都做了，还多给一份状态（`window.tatamibari.serviceWorker`）。
两处都注册 ⇒ 同一份脚本被注册两次。删的是**重复的那一份**，功能由 `js/main.js` 承担。

### 3.3 `index.html`

- 工具条里那三行 `#btn-pause` 按钮（带 `assets/ui/pause.png` 与 `#pause-label`）：
  **移**到 HUD 右上角那颗上（不是丢掉）——闸钉的 `.hud-right` 名册里就是 `btn-pause`，
  而 `.toolbar` 名册里没有它。
- 顶栏那颗全屏按钮：只改了 id（`btn-fullscreen` → `btn-fullscreen-top`），位置、文案、图标都在。
- `<script src="js/sw-register.js">` 一行：随那份文件一起删。

### 3.4 文档

`README.md` 与 `DESIGN.md` 的改动**全部是行号钉与读数**，没有删任何一句话。
重钉的 19 处：`index.html:47-51`、`index.html:54-56`、`index.html:89`、`index.html:114-120`、
`index.html:125`、`index.html:144`、`index.html:157-158`、`index.html:187-188`、
`js/main.js:149-154`、`js/main.js:156-157`、README 里「`daily:<本地日期>:<档>`」那一条
（它指的是每日课 seed 的拼法那一行）、`js/main.js:361-362`、
`js/main.js:401-402`、`js/main.js:363`、`tools/scenarios.js:486`→`tools/scenarios.js:1194`、
`tools/scenarios.js:994`、`tools/scenarios.js:1342`、`tools/scenarios.js:1587`。

其中**基线上就已经指错**（不是这次改动带偏的）的那几处：`index.html:31-35`、`index.html:37-41`、
`index.html:73`、`index.html:96-103`、index.html 原第 113 行（现为整段空行）、`index.html:108`、`index.html:155-156`、
`index.html:159-160`、`js/main.js:131-136`、`js/main.js:140-141`、`js/main.js:269-270`、
`js/main.js:308-309`、`js/main.js:231-233`、`tools/scenarios.js:976`、`tools/scenarios.js:1176`、
`tools/scenarios.js:1332`、`tools/scenarios.js:1569`。

## 4. 验收命令（原样输出）

```
$ npm run check
OK

$ npm test
65 通过 / 0 失败      # tools/rule-test.mjs
74 通过 / 0 失败      # tools/counter-test.mjs
206 通过 / 0 失败     # tools/pencil-test.mjs
18 通过 / 0 失败      # tools/doctest.mjs

$ bash tools/verify.sh
---- shape=root 汇总: 11/11 scenarios reported · 393 checks · 0 failed · 18s ----
---- shape=prefix 汇总: 11/11 scenarios reported · 393 checks · 0 failed · 19s ----
=== deploy-set ===
部署集：42 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 61 fail: 0
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
（整条命令退出码 0）

$ node tools/deploy-set.mjs
部署集：42 条引用（含 3 张位图尺寸核对），失败 0 项
rows: 61 fail: 0

$ node tools/deploy-set-selftest.mjs
DS_SELFTEST rc=0（0=每一刀都按预期发力、阴性对照按预期不发力）
```

浏览器闸各场景条数（root 与 prefix 两跑逐字相同）：
`first` 78、`play` 56、`undo` 35、`hint` 17、`clash` 21、`win` 51、`save` 29、`resume` 31、
`layout` 12、`narrow` 12、`pause` 51 —— 合计 **393 条，0 failed**。
场景名册见 `tools/verify.sh:39`。

## 5. 行为变化（需要知会）

1. **暂停中按 Esc 改成「回选档但仍停在暂停态」。** 改之前它会先把暂停解掉（于是这一盘又走表了）。
   现在 Esc 只把你送回选档页，这一盘仍停在暂停态（表不涨、盘面仍锁）；重新开一盘时暂停态自动清掉。
   闸就钉这一条：`view === 'menu' && paused === true`。
2. **暂停那颗按钮从工具条搬到了 HUD 右上角**（图标 + 「暂停 / 继续」文案都还在）。
   工具条那三行按钮少了它，名册变成闸钉的那一串。
3. **顶栏那颗全屏按钮的 id 变成 `btn-fullscreen-top`**，位置与外观不变；它与 HUD 那颗现在驱动
   **同一份**实现，任意一颗点下去都进出全屏一次。
4. **全屏按钮的文案现在会改口**（「全屏」↔「退出全屏」），`aria-pressed` 与 body 的 `fullscreen` 类一起回写；
   改之前文案永远停在「全屏」，而 F 键被两个处理器各进出一次，等于按了没反应。
5. **暂停会作废拖到一半的那一笔**（旧机制独有的行为，这一轮补回 `applyPause`）。
6. **暂停的时钟换成 `runMs` / `runFrom` 那一套**：暂停期间读数一毫秒不动（闸钉的是 `Δ === 0`，
   不是「变慢了」），恢复时第一帧不倒灌。
7. **service worker 只注册一次**（由 `js/main.js` 负责）；`window.tatamibari.serviceWorker` 照旧报状态。
8. **部署集闸钉的实数从 35 / 54 变成 42 / 61**（e5d7c97 当时记为 40 / 59，B4d 复修按页面新增的取径重钉）。 钉的仍然是实数（当前这份页面真的有几条引用、
   全绿时真的跑几条断言），强度没变：改页面而不动这两个数，一样会红。

## 6. 未实现 / 需人接手

- **本仓的「R 键」语义已自洽，不需人接手**：玩法说明写的是「重开本盘（清掉这一盘的墨，seed 与档不变）」，
  代码里的 `restartGame()` 正是这个口径（同一张题面清墨，不换题）。闸没有断言这一条。
- **浏览器只在 headless Chrome 里验过**（root 与 prefix 两种 URL 形态各一跑）：Safari、Firefox、
  真机 iOS/Android、低配设备仍未验过。本仓没有真机矩阵的余力，这条写进 README 的「不承诺」。
- **闸仍盖不到的地方**：`integrity` 不为 null 时那句拒绝文案（`js/ui/game.js:147-149`）长什么样、
  渲染在哪，没有任何断言读过（闸只钉它的反面 `integrity === null`）。
- **顶栏那颗全屏按钮的文案**：它没有文字（图标钮），`aria-label` 随全屏态改口；屏幕阅读器读到的
  是「全屏 / 退出全屏」。

## 7. 基线归因记录（并线前 / 本次改动前的对照）

在 `80a676f` 上开了一个只读 worktree（`/tmp/tata-pre`）跑同一批闸，用来分清「并线/历史带进来的」
与「本来就有」的：

| 闸 | 基线（`80a676f`） | 本次之后 | 归因 |
|---|---|---|---|
| `npm run check` | 红（`Identifier 'paused' has already been declared`） | OK | **本来就有**：上一次有机并线把两套暂停机制各留了一份 `let paused` |
| `npm test`（rule / counter / pencil） | 65 / 74 / 206 条 0 失败 | 同 | 未受影响（这三支不碰 `js/main.js`） |
| `tools/doctest.mjs` | **16 通过 / 2 失败**（`js/main.js:265` 那条 daily 引用指不回实处；`tools/scenarios.js:1332` 那条 pause 引用指不回实处） | 18 通过 / 0 失败 | **本来就有**：文档行号钉早漂了；`doctest` 自检里那条硬编码的 needle（`js/main.js:265`）也一并跟着漂了（毒药行 227 在基线上是空行，自检因此也没真正发力） |
| `tools/deploy-set.mjs` | **红**（实际 43 条引用 / 62 行，钉的是 35 / 54） | 42 条引用 / 61 行 0 失败 | **本来就有**：并线新增的引用没同步到钉上；e5d7c97 因删掉重复的 sw-register 落回 40 / 59，B4d 复修再按 studio.css / haptics.js 两条新增取径重钉到 42 / 61（并抹掉 data: URI 里 url(%23n) 的假引用） |
| `tools/deploy-set-selftest.mjs` | rc=0 | rc=0 | 未受影响 |
| `bash tools/verify.sh`（浏览器闸） | **跑不起来**：模块是 SyntaxError，页面连启动都做不到 | root 393 / 0、prefix 393 / 0 | **本来就有**：整局不可玩 |

> 浏览器闸在基线上根本没有可用的读数（不是"红"，是"连场景都跑不起来"），
> 所以这一仓的"整局不可玩"结论是**读代码 + 语法门**得出的，不是从闸的红里读出来的。

## 8. 上一轮留下的记录

本仓此前没有 `deliverable.md`（`tools/` 里的闸是 `rule-test` / `counter-test` / `pencil-test` /
`doctest` 四支，没有 `test/` 目录，也没有 `repo.test.mjs` 那种核对交付物首行的闸），
所以本文件是该仓的第一份交付物。README 里被本文引用的那些事实（`npm run balance` 的难度分位表、
`tools/deploy-set.mjs` 的引用数口径、`js/store.js` 的纪录比较口径、`tools/scenarios.js` 的场景名册）
都留在 README / DESIGN 里，本次只重钉了行号，没有改它们的说法。

## 9. B4d 复修（2026-10-30）

上一轮交付后，页面又挂上了 `css/studio.css` 与 `js/haptics.js` 两条取径，但部署集闸钉的
实数没有跟着改，`npm test` 的文档腿也红在一处旧行号上。这一轮补齐：

- `tools/deploy-set.mjs`：扫 CSS 的 `url()` 之前先抹掉整段内联 `data:` URI。`studio.css`
  里的 SVG 噪点滤镜写着 `url(%23n)`，它被当成一条取径解析成 `css/%23n`，让闸为一段内联
  图形永远红着。抹掉后引用数 42、断言行数 61，两个钉子同步改到 42 / 61。
- `deliverable.md` 第 3.4 节有一处修复记录用活引用形状写旧行号（原 index.html 第 113 行），
  那行现在已是空行；改成散文式「index.html 原第 113 行（现为整段空行）」，不再是一条会被
  文档腿当成真引用的 `文件:行号`。
- `README.md` 的「解析 N 条」读数跟着从 189 改成 188。

复跑读数：`npm test` 四支 65 / 74 / 206 / 18 条 0 失败；`node tools/deploy-set.mjs`
42 条引用 / 61 行 0 失败；`node tools/deploy-set-selftest.mjs` rc=0；`bash tools/verify.sh`
root 与 prefix 两种形态各 11 场景 393 条 0 失败，`=== ALL GREEN ===`。
