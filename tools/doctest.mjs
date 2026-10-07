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

const PATH_SRC = '[\\w./-]+?\\.(?:js|mjs|cjs|sh|json|yml|html|css)';
const CITE = new RegExp('^(' + PATH_SRC + '):([0-9]+(?:[,-][0-9]+)*)$');
// 锚点可以是成员路径（`window.ferry.state`），但不许是文件路径：body 里带 `/` 的那一类是另一条引用，
// 把它当锚点按字符串去被指的那几行里找，只会凭空造出假红。`file.js::symbol` 这种写法指的是 symbol，
// 先按 `::` 取后段，否则拆出来的首段是文件名（`validate.js`），它当然不在被指的那几行里。
const ID = /^[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]+)*$/;
const tokOf = (body) => {
  if (body.includes('/')) return '';
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  const t = seg.split(/[(:：\s]/)[0];
  return ID.test(t) ? t : '';
};

function parseRefs(text) {
  const spans = [];
  const spanRe = /`([^`\n]+)`/g;
  let m;
  while ((m = spanRe.exec(text))) spans.push({ body: m[1], s: m.index, end: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const c = spans[i].body.match(CITE);
    if (!c) continue;
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
    for (const seg of c[2].split(',')) {
      const parts = seg.split('-').map(Number);
      out.push({ path: c[1], from: parts[0], to: parts[parts.length - 1] || parts[0], anchor });
    }
  }
  return out;
}

function audit(text) {
  const bad = [];
  const refs = parseRefs(text);
  for (const r of refs) {
    const lines = linesOf(r.path);
    if (!lines) { bad.push(`${r.path}:${r.from} 文件不存在`); continue; }
    if (r.from < 1 || r.to > lines.length) {
      bad.push(`${r.path}:${r.from}-${r.to} 越界（该文件共 ${lines.length} 行）`);
      continue;
    }
    if (r.anchor && !lines.slice(r.from - 1, r.to).join('\n').includes(r.anchor)) {
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
  return { refs, bad };
}

const docs = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, f));
ok('仓库根有文档可审（闸的输入集不许自己空掉）', docs.length >= 1, docs.map((d) => path.basename(d)).join(','));

let refs = 0;
const allBad = [];
let docText = '';
for (const d of docs) {
  const t = fs.readFileSync(d, 'utf8');
  docText += t;
  const a = audit(t);
  refs += a.refs.length;
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

// 反空转：六把假引用必须一把不落——文件不存在、行号越界、三种指认写法各自的锚点漂、行数写错。
const fake = audit('出处 `js/nope.js:1`、`js/main.js:99999`、`elapsedMs` 在 `js/main.js:1`、`package.json`（999 行）、`js/main.js:1`（`elapsedMs`）、`js/main.js:1` 的 `elapsedMs`');
ok('假引用六把全被抓到（不存在 / 越界 / 后向锚点漂 / 行数错 / 前向括号锚点漂 / 「的」锚点漂）', fake.bad.length === 6, fake.bad.join(' | '));

// 阳性对照：三种指认写法与真行数必须判绿，否则上一条的"红"可能只是解析器自己坏了。
const pkgLines = linesOf('package.json');
const real = audit('`HEADROOM`（`tools/balance.mjs:61`）与 `package.json`（' + (pkgLines ? pkgLines.length : 0) + ' 行）');
ok('真引用与真行数在同一个解析器下判绿', real.bad.length === 0 && real.refs.length === 1,
  real.bad.join(' | ') + `（refs=${real.refs.length}）`);
const fwd = audit('`tools/balance.mjs:61`（`HEADROOM`）、`tools/balance.mjs:61` 的 `HEADROOM`、`js/engine/validate.js:40`（`validate.js::invalidReason`）');
ok('前向括号、「的」与 `file::symbol` 三种真注解都判绿', fwd.bad.length === 0 && fwd.refs.length === 3,
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
