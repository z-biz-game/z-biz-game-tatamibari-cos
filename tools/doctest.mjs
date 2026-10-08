#!/usr/bin/env node
// ========================================
// tools/doctest.mjs —— 文档行号对账（零依赖，npm run test:docs）
//
// README.md 与 DESIGN.md 里每个数字后面都挂着 `文件:行号`，那句"行号指本仓代码"必须有机器读回来。
// 只查"行号不超过文件长度"连隔壁一行都抓不住：本轮清出来的漂移（`index.html:102` 其实落在 hud 的
// pill 上，画布在 108 行）全部在界内，界内检查一条都不会红。所以加上锚点：贴着引用写在反引号里
// 的那个名字，必须真的出现在被指的那几行里。
//
// 这一条腿不覆盖什么，写在 README 的「没有覆盖」里，别把它当成全量对账：
//   · 续引写法 `:1176`（路径由上文继承）解析不到，闸看不见它；
//   · 锚点只认"前一对反引号里是一个标识符、且与引用之间不跨行、隔开不超过 4 字"的那种，
//     `aria-label`（`index.html:108`）这类带连字符的名字不构成锚点。
// ========================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

const linesOf = (() => {
  const cache = new Map();
  return (p) => {
    if (!cache.has(p)) {
      let arr = null;
      try {
        arr = fs.readFileSync(path.join(ROOT, p), 'utf8').split('\n');
        if (arr[arr.length - 1] === '') arr.pop();
      } catch {
        arr = null;
      }
      cache.set(p, arr);
    }
    return cache.get(p);
  };
})();

const PATH_SRC = '[\\w./-]+?\\.[A-Za-z][A-Za-z0-9]{0,11}'; // 后缀不许写死：写死成某一族的语言时，本腿在那种仓里是哑的，而「0 条引用」读起来和「全核过」一模一样
const CITE = new RegExp('^(' + PATH_SRC + '):([0-9]+(?:[,-][0-9]+)*)$');
// 续引：完整引用后面只写行号——`tools/balance.mjs:61`（`HEADROOM`）之后再写一串数字。本仓文档里
// 这种写法不少，而这条腿以前只认 `path:NN`：它报"全部指到实处"时看的其实是文档的一部分。
// 借规则：只向**同一句里最近的那条完整引用**借出处；句号、分号、空行、新标题都截断这次借。
// 正文里提到一个文件名不构成出处：宁可计入「无法定址」，也不要在错的文件上判绿（判绿比判红糟）。
// 条数不在注释里写（那是一条会漂的话），它由下面的覆盖面行与等值闸现数现钉。
const BARE = /^:([0-9]+(?:[,-][0-9]+)*)$/;
const STOP = /[。！？；]/;
const inheritedPath = (text, spans, i) => {
  for (let j = i - 1; j >= 0; j--) {
    const pc = spans[j].body.match(CITE);
    if (!pc) continue;
    const between = text.slice(spans[j].end, spans[i].s);
    if (between.includes('\n') && (STOP.test(between) || /\n[ \t]*\n/.test(between) || /\n#{1,6} /.test(between))) return null;
    return { path: pc[1] };
  }
  return null;
};
// 锚点可以是成员路径（`window.ferry.state`）。`path/dir/file.js::symbol` 指的是 symbol 而不是那串路径，
// 所以先按最后一个 `::` 取后段；剩下的里还有 `/` 才判"那是另一条引用"——把它当锚点按字符串去被指的
// 那几行里找，只会凭空造出假红。`Math.max(a, b)` 指的是被调的那个函数（切掉参数表），`X = 12` 取等号左端；
// 剩下那些"好几个裸词"的 body 是命令行（`npm run test:docs`），首词不是被引用的东西，硬按它钉就是一次假红。
const ID = /^[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]+)*$/;
const tokOf = (body) => {
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  if (seg.includes('/')) return '';
  // 带 `<占位>` 的模板 body 指的是那串字面量前缀：`daily:<本地日期>:<档>` 说的是 `daily` 这个键的形状。
  // 只有真的写了占位符才这么拆，否则 `test:syntax` 这种脚本名会被拆成 `test`，又是一次假红。
  const tpl = /^([^<>]+?)<[^<>\s]+>/.exec(seg);
  if (tpl && ID.test(tpl[1].split(':')[0].trim())) return tpl[1].split(':')[0].trim();
  const head = seg.split('(')[0].trim();
  if (ID.test(head)) return head;
  const lhs = head.split(/[=:]\s/)[0].trim();
  return ID.test(lhs) ? lhs : '';
};

function parseRefs(text, orphans = null) {
  const spans = [];
  const spanRe = /`([^`\n]+)`/g;
  let m;
  while ((m = spanRe.exec(text))) spans.push({ body: m[1], s: m.index, end: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const c = spans[i].body.match(CITE);
    const bare = c ? null : BARE.exec(spans[i].body);
    if (!c && !bare) continue;
    const owner = c ? { path: c[1] } : inheritedPath(text, spans, i);
    if (!owner) { if (orphans) orphans.push(bare[0]); continue; }
    let anchor = '';
    let consumed = false;
    // 三种指认写法：`path:NN`（`name`）、`path:NN` 的 `name`（都算前向），以及 `name`（`path:NN`）（后向）。
    const next = spans[i + 1];
    const gA = next ? text.slice(spans[i].end, next.s) : null;
    if (gA !== null && gA.length <= 4 && !gA.includes('\n')) {
      const gN = gA.replace(/\s+/g, '');
      if (/^[（(]/.test(gN) || gN === '的') { consumed = true; anchor = tokOf(next.body); }
    }
    // 前向没认出注解形状时才接着试后向。早先用 `else if` 挂在前向条件上，
    // 「`elapsedMs` 在 `js/main.js:1`、」这种后面紧跟短间隔的写法就把后向那把弄哑了。
    if (!consumed && i > 0) {
      const prev = spans[i - 1];
      const gap = text.slice(prev.end, spans[i].s);
      // 后向的间隔得是指认形状：`（` 或带字的「在 / 的」。纯标点（`，`、`、`）说明前面那个名字
      // 只是列表的上一项，不是这条引用的主语——按它钉就是假红。
      const gT = gap.replace(/\s+/g, '');
      const shaped = /^[（(]/.test(gT) || /[\w一-鿿]/.test(gT);
      if (shaped && !/\s/.test(prev.body) && gap.length <= 4 && !gap.includes('\n')) anchor = tokOf(prev.body);
    }
    // 续引只借路径——它自己印的那些数字才是文档的主张。
    const range = c ? c[2] : bare[1];
    for (const seg of range.split(',')) {
      const parts = seg.split('-').map(Number);
      out.push({ path: owner.path, from: parts[0], to: parts[parts.length - 1] || parts[0], anchor, cont: !c });
    }
  }
  return out;
}

// 认整词，不认子串：`MARKER` 坐在声明 `MARKER_CHAR` 的那一行上也算"出现过"，一个短名字会
// "出现在"任何碰巧含它的标识符里——子串口径因此比它替掉的那份手抄锚点表**更弱**，于是一次真的漂
// 会被读成绿。名字两侧再是标识符字符（字母、数字、`_`、`$`）就不是这个标识符本身。
// 缓存是因为一份文档要拿同一个名字核上百次。
const wordCache = new Map();
const hasWord = (text, name) => {
  if (!wordCache.has(name)) {
    wordCache.set(name, new RegExp('(^|[^A-Za-z0-9_$])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_$])'));
  }
  return wordCache.get(name).test(text);
};

function audit(text) {
  const bad = [];
  const orphans = [];
  const refs = parseRefs(text, orphans);
  for (const r of refs) {
    const lines = linesOf(r.path);
    if (!lines) { bad.push(`${r.path}:${r.from} 文件不存在`); continue; }
    if (r.from < 1 || r.to > lines.length) {
      bad.push(`${r.path}:${r.from}-${r.to} 越界（该文件共 ${lines.length} 行）`);
      continue;
    }
    // 在范围内不等于"指到了东西"：没有锚点的引用漂到空行上，旧规则读成绿——2026-10-07 在同族审计腿
    // 的一条真漂移上实测过（文档写 `…:79`，79 行是 `};` 与段标题之间的空白，闸当时打「指不回实处的
    // 0 条」并退 0）。整段空白只报这一条就不再找锚点：空段里必然找不到，报两行会把一把刀的红拆成两行。
    if (lines.slice(r.from - 1, r.to).join('').trim() === '') {
      bad.push(`${r.path}:${r.from}-${r.to} 那几行整段是空行`);
      continue;
    }
    if (r.anchor && !hasWord(lines.slice(r.from - 1, r.to).join('\n'), r.anchor)) {
      bad.push(`${r.path}:${r.from}-${r.to} 那几行里没有 ${r.anchor}`);
    }
  }
  const cntRe = new RegExp('`(' + PATH_SRC + ')`（([0-9]+) 行）', 'g');
  let m;
  while ((m = cntRe.exec(text))) {
    const lines = linesOf(m[1]);
    if (!lines) bad.push(`${m[1]}（${m[2]} 行）文件不存在`);
    else if (lines.length !== Number(m[2])) bad.push(`${m[1]} 实测 ${lines.length} 行，文档写的是 ${m[2]}`);
  }
  return { refs, bad, cont: refs.filter((r) => r.cont).length, unaddressed: orphans.length };
}

const docs = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, f));
ok('仓库根有文档可审（闸的输入集不许自己空掉）', docs.length >= 1, docs.map((d) => path.basename(d)).join(','));

let refs = 0;
let contRefs = 0;
let unaddressed = 0;
const allBad = [];
let docText = '';
for (const d of docs) {
  const t = fs.readFileSync(d, 'utf8');
  docText += t;
  const a = audit(t);
  refs += a.refs.length;
  contRefs += a.cont;
  unaddressed += a.unaddressed;
  for (const b of a.bad) allBad.push(`${path.basename(d)} · ${b}`);
}
ok('文档里每一条 文件:行号 与每一处「N 行」都指到实处', allBad.length === 0,
  `解析 ${refs} 条` + (allBad.length ? ' · 指不回实处的 ' + allBad.join(' | ') : ''));

// 缩样自检：这条腿读到的引用数就是它自己的覆盖面。文档缩到只剩几条时它必须说话。
ok('文档的行号引用多到闸能看见（少于 60 条就是缩样）', refs >= 60, `这一跑只解析到 ${refs} 条`);

// 等值闸：文档里转写的「解析 N 条」必须等于闸自己数出来的那个数，且文档确实写了它——
// 把数字删掉同样算红，否则"对账"退化成"没写就没有错"。
{
  const claims = [...docText.matchAll(/解析 (\d+) 条/g)].map((x) => Number(x[1]));
  ok('文档里每一处「解析 N 条」读数都等于闸自己数出来的（且文档确实写了这个数）',
    Number.isInteger(refs) && claims.length >= 1 && claims.every((c) => c === refs),
    `闸数到 ${refs} · 文档写了 ${claims.length} 处：${[...new Set(claims)].join('/')}`);
}

// 续引在本仓文档里到底借到了没有：一条也没有就是这条规则在自己仓里空转。
ok('两份文档里确有续引在同句内借到了出处（一条也没有就是这条规则空转）',
  contRefs >= 1 && contRefs < refs, `解析 ${refs} 条 · 其中续引借到出处 ${contRefs} 条`);

// 借不到出处的那些不判错、也不静默跳过：数出来写进 README，再由这一条逐处钉住。
// 新增一条定不了址的引用会把闸打红，而不是让覆盖面悄悄缩水。
{
  const gapClaims = [...docText.matchAll(/无法定址 (\d+) 处/g)].map((x) => Number(x[1]));
  ok('文档里每一处「无法定址 N 处」都等于闸数到的借不到出处的续引（且文档确实写了这个数）',
    Number.isInteger(unaddressed) && gapClaims.length >= 1 && gapClaims.every((c) => c === unaddressed),
    `闸数到 ${unaddressed} · 文档写了 ${gapClaims.length} 处：${[...new Set(gapClaims)].join('/')}`);
}

// 续引的七把控制腿，全在内存里、盘上的文档一个字不动：
// 借到 / 句尾墙 / 软换行仍算同一句 / 空行与新标题截断 / 借来的路径喂进边界检查 /
// 正文里提到的文件名不是出处 / 同一句改写成完整引用就读得回来。
const cG = audit('`HEADROOM`（`tools/balance.mjs:61`）、`HIT_GATE`（`:47`）');
ok('续引在同句内借到出处，并带上自己那一格的指认',
  cG.refs.length === 2 && cG.refs.filter((r) => r.cont).length === 1 && cG.unaddressed === 0 && cG.bad.length === 0 &&
  cG.refs.every((r) => r.path === 'tools/balance.mjs'),
  `refs=${cG.refs.length} 红=${cG.bad.join(' | ') || '无'} 借不到=${cG.unaddressed}`);
const cW = audit('`HEADROOM`（`tools/balance.mjs:61`）。\n`HIT_GATE`（`:47`）');
ok('句号把借的窗口关上：下一句的续引不许挂到上一句的出处上',
  cW.refs.length === 1 && cW.unaddressed === 1, `refs=${cW.refs.length} 借不到=${cW.unaddressed}`);
const cP = audit('`HEADROOM`（`tools/balance.mjs:61`）、\n`HIT_GATE`（`:47`）');
ok('软换行不算换句：同一句折行后续引照样借得到',
  cP.refs.length === 2 && cP.unaddressed === 0, `refs=${cP.refs.length} 借不到=${cP.unaddressed}`);
const cH = audit('`HEADROOM`（`tools/balance.mjs:61`）\n\n## 续\n`HIT_GATE`（`:47`）');
ok('空行与新标题同样截断这次借', cH.refs.length === 1 && cH.unaddressed === 1,
  `refs=${cH.refs.length} 借不到=${cH.unaddressed}`);
const cB = audit('`HEADROOM`（`tools/balance.mjs:61`）、`HIT_GATE`（`:99999`）');
ok('借来的路径喂进边界检查：续引写一个越界的行号必须红，并点名被借的那个文件',
  cB.bad.length === 1 && cB.bad[0].includes('tools/balance.mjs') && cB.bad[0].includes('越界'),
  cB.bad.join(' | ') || '（没红）');
const cF = audit('这条常量住在 `balance.mjs` 里，`HIT_GATE`（`:47`）');
ok('正文里提到的文件名不是出处：这种写法必须算借不到，而不是在错的文件上判绿',
  cF.refs.length === 0 && cF.unaddressed === 1, `refs=${cF.refs.length} 借不到=${cF.unaddressed}`);
const cC = audit('这条常量住在 `balance.mjs` 里，`HIT_GATE`（`tools/balance.mjs:47`）');
ok('同一句改写成完整引用就读得回来：上一条红的是写法，不是解析器漏了这一句',
  cC.refs.length === 1 && cC.unaddressed === 0 && cC.bad.length === 0,
  `refs=${cC.refs.length} 借不到=${cC.unaddressed} 红=${cC.bad.join(' | ') || '无'}`);

// 反空转：九把假引用必须一把不落——文件不存在、行号越界、四种指认写法各自的锚点漂、行数写错、
// 一条没有锚点却整段落在空行上的、以及一把**前缀**（名字只是被指那行里某个标识符的前缀，整词不算
// 命中而子串算）。第八把那行的行号是当场从 js/main.js 数出来的空行，不手抄，
// 所以源码怎么漂它都还指着真空行；blankAt 自己数不到空行时这条算红，而不是少一把。
// 第九把是本腿整词口径的牙：它哪天退回 .includes，所有候选都会"过"，红的正是这一把少掉。
const mainLines = linesOf('js/main.js') || [];
let blankAt = 0;
for (let i = 1; i < mainLines.length; i++) if (String(mainLines[i]).trim() === '') { blankAt = i + 1; break; }
const fake = audit('出处 `js/nope.js:1`、`js/main.js:99999`、`elapsedMs` 在 `js/main.js:1`、`package.json`（999 行）、`js/main.js:1`（`elapsedMs`）、`js/main.js:1` 的 `elapsedMs`、`js/main.js:1`（`Math.max(2, Math.ceil(0.5))`）、' +
  `\`js/main.js:${blankAt}\`` + '、`js/engine/counter.js:33`（`MARKER`）');
ok('假引用九把全被抓到（不存在 / 越界 / 后向锚点漂 / 行数错 / 前向括号锚点漂 / 「的」锚点漂 / 函数调用形式锚点漂 / 没有锚点却落在空行上 / 前缀不算整词）',
  blankAt > 0 && fake.bad.length === 9, `空行靶子在第 ${blankAt} 行 · ${fake.bad.join(' | ')}`);

// 阳性对照：三种指认写法与真行数必须判绿，否则上一条的"红"可能只是解析器自己坏了。
const pkgLines = linesOf('package.json');
const real = audit('`HEADROOM`（`tools/balance.mjs:61`）与 `package.json`（' + (pkgLines ? pkgLines.length : 0) + ' 行）');
ok('真引用与真行数在同一个解析器下判绿', real.bad.length === 0 && real.refs.length === 1,
  real.bad.join(' | ') + `（refs=${real.refs.length}）`);
// 「不该指认」的那一组也算正样本：带空格的命令行 body 在"按首词切"的老写法下会拿 `npm` 当锚点，
// 在它自己造的那一行上红——这一组把那条退路钉住。
const fwd = audit('`tools/balance.mjs:61`（`HEADROOM`）、`tools/balance.mjs:61` 的 `HEADROOM`、' +
  '`js/engine/validate.js:40`（`js/engine/validate.js::invalidReason`）、' +
  '`js/engine/generate.js:217`（`Math.max(2, Math.ceil(density * markers.length))`）、' +
  '`js/engine/generate.js:217`（`npm run test:docs`）');
ok('前向括号、「的」、`path::symbol`、函数调用四种真注解，加上带空格的命令行 body，都在同一个解析器下判绿',
  fwd.bad.length === 0 && fwd.refs.length === 5,
  fwd.bad.join(' | ') + `（refs=${fwd.refs.length}）`);
// 反方向的控制：逗号不是指认。前面那个名字只是列表的上一项，按它钉会把正确的文档读红。
// 这一把只有在线 61 真的没有 elapsedMs 时才算数——它没有，所以规则一松就会被推翻。
const comma = audit('`elapsedMs`，`tools/balance.mjs:61`');
ok('纯标点间隔（`，`）不构成指认：这种写法必须判绿', comma.bad.length === 0 && comma.refs.length === 1,
  comma.bad.join(' | ') + `（refs=${comma.refs.length}）`);

// 这条腿对本仓文档真有牙齿：把日课那条引用挪回它本轮之前真待过的 227（那是 totalsLine 的一行，
// 在界内、越界检查不会红），只有锚点 `daily` 抓得住。改的是内存里的副本，盘上的文档一个字不动。
{
  const needle = '`js/main.js:265`';
  const hits = docText.split(needle).length - 1;
  const poisoned = docText.replace(needle, '`js/main.js:227`');
  const p = audit(poisoned);
  ok('把文档里一条真引用的行号挪歪到隔壁语句，这条腿必须为它变红',
    hits === 1 && p.bad.length >= 1 && p.bad.some((b) => b.includes('daily')),
    `needle 命中 ${hits} 处 · 红在 ${p.bad.join(' | ') || '（一处都没红）'}`);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
