#!/usr/bin/env node
/**
 * xhs-prompt-library · 框架验证体检
 *
 * 查两件事：
 *   1. 引用完整性 —— 案例里每个维度码在词条表里真实存在（防止改码后配方静默失效）
 *   2. 覆盖矩阵   —— 5 个案例压到了哪些分支，哪些还是盲区
 *
 * 不保证：提示词出图效果好不好、CTR 数字是否属实（那些是实测与外部数据的事）。
 *
 * 用法：node tools/check_cases.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const DATA = path.join(__dirname, "..", "data");

// 案例 combo 的键 → 词条文件名
const DIM = {
  form: "forms.json",
  cover: "covers.json",
  layout: "layouts.json",
  layout2: "layouts165.json",
  palette2: "palette36.json",
  style: "styles.json",
  size: "sizes.json",
  palette: "palettes.json",
  font: "fonts.json",
  decor: "decor.json",
};

// 出图必须带的硬约束
const HARD = ["no watermark", "no logo", "no deformed fingers", "natural features"];

let pass = 0, fail = 0;
const bad = [];
function ok(cond, label, detail) {
  if (cond) { pass++; }
  else { fail++; bad.push(label + (detail ? "  → " + detail : "")); }
}

function load(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
}

// ---- 0. 装载全部词条表，索引 code -> 条目 -------------------------
const tables = {};
for (const [dim, file] of Object.entries(DIM)) {
  const j = load(file);
  const map = new Map();
  for (const it of j.items) {
    if (map.has(it.code)) bad.push(`重复码 ${dim}:${it.code}`);
    map.set(it.code, it);
  }
  tables[dim] = map;
  ok(map.size === j.meta.count,
    `${dim} meta.count 与实际条数一致`,
    `声明 ${j.meta.count} 实际 ${map.size}`);
}

const cases = load("cases.json");
ok(cases.items.length === cases.meta.count,
  "cases meta.count 与实际条数一致");
ok(Object.keys(cases.items[0].combo).some((k) => k === "form"),
  "cases.json combo 用单数键（与 DIMS 对齐）");

// ---- 1. 案例级断言 ----------------------------------------------
const used = {};                       // dim -> Set(code)
for (const dim of Object.keys(DIM)) used[dim] = new Set();

for (const c of cases.items) {
  const tag = c.code;

  // 1.1 八个维度齐全
  const missing = Object.keys(DIM).filter((d) => !c.combo || !c.combo[d]);
  ok(missing.length === 0, `${tag} 八个维度齐全`, `缺 ${missing.join(",")}`);

  // 1.2 每个维度码真实存在（引用完整性 —— 核心防漏）
  for (const dim of Object.keys(DIM)) {
    const code = c.combo && c.combo[dim];
    if (!code) continue;
    ok(tables[dim].has(code),
      `${tag} ${dim}=${code} 在词条表中存在`,
      tables[dim].has(code) ? "" : "词条表里没这个码");
    used[dim].add(code);
  }

  // 1.3 视觉指令必须带全四条硬约束
  const vp = c.visualPrompt || "";
  for (const h of HARD) {
    ok(vp.toLowerCase().includes(h), `${tag} 视觉指令含硬约束「${h}」`);
  }

  // 1.4 视觉指令必须声明画幅，且与 size 词条一致（读 ratio 字段，不解析 px 字符串）
  const sizeItem = tables.size.get(c.combo.size);
  ok(!!sizeItem, `${tag} size 词条可解析`);
  const wantRatio = sizeItem && sizeItem.ratio;
  ok(!!wantRatio, `${tag} size 词条带 ratio 字段（供断言用）`);
  ok(vp.includes(wantRatio),
    `${tag} 视觉指令画幅与 size 一致`,
    `size=${c.combo.size} 期望含 ${wantRatio}`);

  // 1.5 中文文案必须给出主标题（否则等于没做内容层）
  ok(c.copyTemplate && c.copyTemplate["主标题"],
    `${tag} 中文文案含主标题`);

  // 1.6 案例必须写明验证点 —— 不知道验证什么的案例等于没测
  ok(!!c.verifyPoint, `${tag} 声明了验证点`);
  ok(!!c.notes, `${tag} 附使用注意`);

  // 1.7 combo 的键必须恰好是 8 个维度，不许混进非维度键
  // （曾混入 layout_note: "拼贴封面+密集模块内页" 这句中文备注，
  //  网页渲染时 D[undefined].items 直接炸掉 —— 码全对，静态检查测不到）
  const comboKeys = Object.keys(c.combo || {}).sort();
  const expect = Object.keys(DIM).sort();
  ok(comboKeys.length === expect.length &&
     expect.every((k, i) => comboKeys[i] === k),
    `${tag} combo 键恰为 8 个维度`,
    `实际 ${comboKeys.join(",")}`);
}

// ---- 2. 覆盖矩阵 ------------------------------------------------
console.log("\n─── 覆盖矩阵（5 案例压到的分支）───\n");
const rows = Object.keys(DIM).map((dim) => {
  const total = tables[dim].size;
  const hit = used[dim].size;
  return { 维度: dim, 已验证: `${hit}/${total}`, 覆盖: `${Math.round((hit / total) * 100)}%` };
});
console.table(rows);

// form / cover / layout 是框架主轴，单独列出用了哪些
for (const dim of ["form", "cover", "layout", "style"]) {
  const names = [...used[dim]].map((c) => {
    const it = tables[dim].get(c);
    return `${c} ${it ? it.zh : "?"}`;
  });
  console.log(`${dim.padEnd(7)}: ${names.join(" / ")}`);
}

// ---- 2.5 网页引用完整性 ----------------------------------------
// index.html 里的 REC 映射写死了维度码，改词条表后不会自动跟着变 —— 必须静态扫。
// 曾出现过 ST-19 → PA-19（PA 只有 01~10），静默留在界面里，用户选了莫兰迪拿到空配色。
const idxPath = path.join(__dirname, "..", "index.html");
const bundlePath = path.join(__dirname, "..", "assets", "data-bundle.js");
const bundleKeys = new Set();
if (fs.existsSync(bundlePath)) {
  const src = fs.readFileSync(bundlePath, "utf8");
  const m = src.match(/window\.XHS = (\{[\s\S]*\});/);
  if (m) Object.keys(JSON.parse(m[1])).forEach((k) => bundleKeys.add(k));
  ok(bundleKeys.size >= 13, "bundle 含 13 个数据表", `实际 ${bundleKeys.size}`);
}
if (fs.existsSync(idxPath)) {
  const html = fs.readFileSync(idxPath, "utf8");
  const refMap = { FO: "form", CV: "cover", LO: "layout", ST: "style",
                   SZ: "size", PA: "palette", FT: "font", DE: "decor" };
  const seen = new Set();
  for (const m of html.matchAll(/\b(FO|CV|LO|ST|SZ|PA|FT|DE)-\d+\b/g)) {
    const code = m[0];
    const key = code.split("-")[0];
    if (!seen.has(code)) { seen.add(code); ok(tables[refMap[key]].has(code),
      `index.html 引用 ${code} 存在`, "词条表里没这个码"); }
  }
  // 推荐映射里的维度码必须与该维度词条同类（防把 layout 码写进 form 槽）
  // 网页里 DIMS 用【单数】维度键，bundle 数据表用【复数】键，靠 DATA_OF 互转。
  // 曾两边都写单数导致 D[d.k].items 读 undefined、整页白屏 —— 码全对，静态检查测不到。
  // 这条断言钉住：8 个单数维度键都必须有对应的复数数据表，且都在 DATA_OF 里映射。
  const dimBlock = html.match(/const DIMS = \[[\s\S]*?\n\];/);
  if (dimBlock) {
    const keys = [...dimBlock[0].matchAll(/k:"([a-z0-9]+)"/g)].map((m) => m[1]);
    ok(keys.length === 9, "index.html DIMS 有 9 个维度键", `实际 ${keys.length}`);
const mapBlock = html.match(/const DATA_OF = \{[\s\S]*?\};/);
  ok(!!mapBlock, "index.html 有 DATA_OF 映射表");
  // 直接从页面 DATA_OF 解析映射，不自己拼复数（layout2→layouts165、palette2→palette36
  // 这类不规则命名猜不出来，硬拼只会写出假断言）
const mapOf = {};
if (mapBlock) {
  for (const m of mapBlock[0].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) mapOf[m[1]] = m[2];
}
keys.forEach((k) => {
      const plural = mapOf[k];
      ok(!!plural, `DATA_OF 定义了维度 "${k}" 的数据表`);
      if (!plural) return;
      ok(bundleKeys.has(plural), `维度 "${k}" → 数据表 "${plural}" 在 bundle 中存在`);
    });

// ★ 防复发：单数/复数混用在本项目已犯两次（index.html 一次、gacha.js 一次），
    // 症状都是「读 undefined 却静默」。
    // 扫出 `["键", "中文名"` 形态的字面量维度键，要求都在 DATA_OF 里（DATA_OF 是权威）。
    // 白名单式写法已试过 —— 枚举永远漏得掉新键，且实测注入 layoutX 全绿没抓到。
    // 已知边界：本断言只覆盖 `[k,v]` 二元字面量；渲染冒烟才是渲染层的兜底。
    const litDims = [...html.matchAll(/\[\s*"([a-z0-9_]+)"\s*,\s*"[^"]*"/g)].map((m) => m[1]);
    ok(litDims.length >= 9, "扫到足够多的字面量维度键（断言自身有效）", `扫到 ${litDims.length} 处`);
    [...new Set(litDims)].forEach((k) => ok(mapOf[k] !== undefined,
      `字面量维度键 "${k}" 在 DATA_OF 里有映射`, "该键无映射，渲染时会读 undefined"));
    // DIMS 的键也必须在 DATA_OF 里（交叉验证）
    keys.forEach((k) => ok(mapOf[k] !== undefined,
      `DIMS 里的 "${k}" 在 DATA_OF 有映射`, "DIMS 有它但 DATA_OF 没有"));
    // DATA_OF 声明的表必须真实存在（反向：别指向不存在的表）
    Object.values(mapOf).forEach((t) => ok(bundleKeys.has(t),
      `DATA_OF 指向的表 "${t}" 真实存在`));
    // gacha.js 里也必须有 DATA_OF，且它的 DIMS 键都在映射内
    const gachaPath = path.join(__dirname, "..", "assets", "gacha.js");
    if (fs.existsSync(gachaPath)) {
      const gacha = fs.readFileSync(gachaPath, "utf8");
      ok(/const DATA_OF = \{/.test(gacha), "gacha.js 有 DATA_OF 映射表");
      ok(!/require\("\.\/data-bundle\.js"\)/.test(gacha),
        "gacha.js 不 require data-bundle.js（那是浏览器脚本，require 拿不到）");
      const gDims = gacha.match(/const DIMS = \[([\s\S]*?)\];/);
      if (gDims) {
        const gKeys = [...gDims[1].matchAll(/k:\s*"([a-z0-9]+)"/g)].map((m) => m[1]);
        ok(gKeys.length > 0, "gacha.js DIMS 非空");
        gKeys.forEach((k) => ok(mapOf[k] !== undefined,
          `gacha 槽 "${k}" 在 index.html DATA_OF 里有映射`));
      }
    }
  }

  const recBlock = html.match(/form:\s*\{[\s\S]*?\},\s*style:\s*\{[\s\S]*?\}/);
  if (recBlock) {
    ok(!/\bPA-19\b/.test(html), "无越界调色板码 PA-19");
    ok(!/\b(FO|CV|LO|ST|SZ|PA|FT|DE)-(9[1-9]|[1-9]\d{2,})\b/.test(html),
      "无越界编号（>90 或三位以上）");
  }
}

// ---- 2.7 新增精细图鉴的内容质量 ---------------------------------
// layouts165 / palette36 是「拿来就出图」的内容层，
// 必须验 prompt 本身可用：非空、含小红书前缀、含固定收尾约束。
const lay2 = JSON.parse(fs.readFileSync(path.join(DATA, "layouts165.json"), "utf8"));
ok(lay2.items.length === 165, "layouts165 有 165 条", `实际 ${lay2.items.length}`);
// 提示词长度：IP 段有 2 条上游原文仅一句话（IP-003 / IP-011），信息量不足以直接出图。
// 不改上游数据，但必须如实记为「需补充」，不能假装齐整。
const layCats = {};
const THIN = 20;
const thin = [];
lay2.items.forEach((it) => {
  layCats[it.cat] = (layCats[it.cat] || 0) + 1;
  ok(it.code && it.zh, `${it.code} 有编码与中文名`);
  ok(it.prompt && it.prompt.length > 0, `${it.code} 提示词非空`);
  if (it.prompt.length < THIN) thin.push(it.code);
});
ok(thin.length <= 4, "提示词过短的条目不超过 4 条（上游 IP 段遗留）",
  `过短：${thin.join(",")}`);
// 过短的条目要在界面上标出来，别让用户当成完整配方用
if (thin.length) {
  console.log(`  ⚠ 提示词偏薄（已建议补充）：${thin.join(", ")}`);
}
// 图鉴提示词必须自带平台前缀与背景约束 —— 这是它能直接出图的前提
const igItems = lay2.items.filter((i) => i.cat === "IG");
ok(igItems.length === 35, "IG 信息图 35 条", `实际 ${igItems.length}`);
ok(igItems.filter((i) => i.prompt.includes("小红书信息图")).length >= 30,
  "IG 多数条目含「小红书信息图」前缀",
  `实际 ${igItems.filter((i) => i.prompt.includes("小红书信息图")).length}`);
ok(lay2.items.filter((i) => /留白/.test(i.prompt)).length >= 40,
  "多数排版条目含留白约束（防模型塞满画面）",
  `实际 ${lay2.items.filter((i) => /留白/.test(i.prompt)).length}`);
// 编码唯一
ok(new Set(lay2.items.map((i) => i.code)).size === 165, "layouts165 编码无重复");

const pal36 = JSON.parse(fs.readFileSync(path.join(DATA, "palette36.json"), "utf8"));
ok(pal36.items.length === 36, "palette36 有 36 条", `实际 ${pal36.items.length}`);
ok(pal36.groups.length === 6, "主题色分 6 组", `实际 ${pal36.groups.length}`);
ok(new Set(pal36.items.map((i) => i.code)).size === 36, "palette36 编码无重复");
pal36.items.forEach((it) => {
  ok(it.prompt && it.prompt.includes("主题色"), `${it.code} 提示词含「主题色」指令`);
  ok(/（.*）/.test(it.prompt), `${it.code} 带英文色名（模型识别英文更稳）`);
});

const sp = JSON.parse(fs.readFileSync(path.join(DATA, "stylepair.json"), "utf8"));
ok(sp.pairs.length >= 10, "搭配参考 ≥10 组", `实际 ${sp.pairs.length}`);
sp.pairs.forEach((p) => {
  ok(!!p.why && p.why.length > 8, `${p.scene} 有具体推荐理由（禁套话）`);
  ok(Array.isArray(p.colors) && p.colors.length > 0, `${p.scene} 给了主题色`);
  // 搭配里的风格码与色码必须真实存在
  p.styles.forEach((s) => ok(tables.style.has(s), `搭配 ${p.scene} 风格码 ${s} 存在`));
  p.colors.forEach((c) => {
    const cc = c.split(" ")[0];
    ok(pal36.items.some((x) => x.code === cc), `搭配 ${p.scene} 色码 ${cc} 存在`);
  });
});

// ---- 2.8 画廊与自定义工作台 -------------------------------------
const ROOTDIR = path.join(__dirname, "..");
const gal = JSON.parse(fs.readFileSync(path.join(DATA, "gallery.json"), "utf8"));
ok(gal.items.length >= 40, "画廊至少 40 张", `实际 ${gal.items.length}`);
gal.items.forEach((it) => {
  // 图必须真实在磁盘上 —— 否则画廊是空图，而网页不会报错
  const p = path.join(ROOTDIR, it.img);
  ok(fs.existsSync(p), `${it.code} 图片文件存在`, it.img);
  if (fs.existsSync(p)) {
    const sz = fs.statSync(p).size;
    ok(sz > 20000, `${it.code} 图片非空`, `仅 ${sz} 字节`);
  }
  // 文字校验结论必须写下来（这是画廊的价值所在）
  ok(!!it.textCheck, `${it.code} 记录了中文文字校验结论`);
  ok(!!it.look, `${it.code} 记录了画面看点`);
  // 配方可复现：要有完整提示词，且含硬约束
  ok(it.rebuild && it.rebuild.prompt && it.rebuild.prompt.length > 30,
    `${it.code} 可复现提示词`);
  ok(/水印|logo/i.test(it.rebuild.prompt), `${it.code} 提示词含水印约束`);
  // 版式与主题色必须真在图里出现过，不能对不上
  ok(!!it.layout2, `${it.code} 标了版式`);
  ok(!!it.palette2, `${it.code} 标了主题色`);
  // 码引用真实存在
  ["form", "cover", "style"].forEach((k) =>
    ok(tables[k].has(it[k]), `${it.code} 的 ${k}=${it[k]} 存在`));
  ok(tables.layout2.has(it.layout2), `${it.code} 的 layout2=${it.layout2} 存在`);
  ok(pal36.items.some((x) => x.code === it.palette2), `${it.code} 的 palette2=${it.palette2} 存在`);
});
ok(new Set(gal.items.map((i) => i.code)).size === gal.items.length, "画廊编码无重复");
ok(gal.notes && /水印/.test(gal.notes.watermark || ""), "画廊记录了水印事实");

const cus = JSON.parse(fs.readFileSync(path.join(DATA, "custom.json"), "utf8"));
ok(cus.topicPresets.length >= 10, "选题预设 >=10", `实际 ${cus.topicPresets.length}`);
ok(cus.titleFormulas.length >= 6, "标题公式 >=6", `实际 ${cus.titleFormulas.length}`);
cus.topicPresets.forEach((p) => {
  ok(!!p.hook && p.hook.length > 4, `${p.id} 有可用钩子示例`);
  ok(!!p.audience, `${p.id} 有人群标签`);
  ok(tables.form.has(p.form), `${p.id} 的 form=${p.form} 存在`);
  ok(tables.style.has(p.style), `${p.id} 的 style=${p.style} 存在`);
});
cus.titleFormulas.forEach((f) => {
  ok(!!f.why && f.why.length > 6, `${f.id} 有公式理由（不是裸公式）`);
  ok(!!f.example, `${f.id} 有示例`);
});

// ---- 2.9 素材授权红线 + 措辞查重 --------------------------------
const rt = JSON.parse(fs.readFileSync(path.join(DATA, "rights.json"), "utf8"));
ok(rt.items.length >= 5, "授权红线 >=5 条", `实际 ${rt.items.length}`);
rt.items.forEach((it) => {
  ok(!!it.rule, `${it.id} 有规则表述`);
  ok(!!it.risk, `${it.id} 写明后果（出错代价是保留它的理由）`);
  ok(["必守", "建议"].includes(it.level), `${it.id} 分了等级（${it.level}）`);
});
ok(rt.items.some((x) => x.level === "必守"), "有必守项");
ok(rt.items.some((x) => /肖像|版权|授权|许可/.test(x.rule + x.risk)),
  "覆盖了肖像/版权维度（唯一机器查不了、出错有代价的一类）");
ok(new Set(rt.items.map((i) => i.id)).size === rt.items.length, "授权编码无重复");
ok(/借鉴/.test(rt.meta.origin || "") && /自写/.test(rt.meta.origin || ""),
  "授权清单写明借鉴来源与自写部分");

// 措辞查重：借鉴方法论不抄表达
// require 同一份核心判据（copy-core.js），不 spawn 子进程—— Windows 下
// 同步 spawn 同进程会 EBUSY 且拿不到 stdout，实测踩过。
const { checkCopy } = require("./copy-core.js");
const R = checkCopy(path.join(__dirname, ".."));
ok(!!R, "查重核心可加载");
ok(R.total === 0, `措辞查重 0 雷同（当前 ${R.total}，判定 ${R.verdict}）`,
  R.total > 0 ? R.details.slice(0, 6).map((d) => `「${d.frag}」@${d.file} ← ${d.src}`).join("; ") : "");
ok(R.scanned >= 10, `查重扫描了 ${R.scanned} 个文件`, `实际 ${R.scanned}`);

// ---- 3. 盲区量化（框架深度的作业清单）---------------------------
const comboSpace = tables.form.size * tables.layout.size;
console.log(`\n─── 盲区 ───`);
console.log(`form × layout 组合空间 ${tables.form.size}×${tables.layout.size} = ${comboSpace}`);
console.log(`已验证 ${cases.items.length} 条 → 覆盖率 ${((cases.items.length / comboSpace) * 100).toFixed(1)}%`);
const untouched = [];
for (const dim of Object.keys(DIM)) {
  const n = tables[dim].size - used[dim].size;
  if (n > 0) untouched.push(`${dim} ${n} 条未压到`);
}
console.log(`未压到的词条：${untouched.join(" / ")}`);

// ---- 汇总 -------------------------------------------------------
console.log(`\n${"─".repeat(46)}`);
if (fail === 0) {
  console.log(`✅ 全绿 ${pass} 项`);
} else {
  console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
  bad.forEach((b) => console.log("  · " + b));
}
console.log("注意：本体检只验结构与引用，不验出图效果。CTR 数字来自外部拆解，非本库实测。");
process.exit(fail === 0 ? 0 : 1);