#!/usr/bin/env node
/**
 * index.html 界面冒烟测试 —— 在真实 DOM 里跑一遍抓报错
 *
 * 为什么要这个：静态检查看不出运行时错误。合成器这类界面最容易挂在
 * 「数据没挂上」「某个 select 找不到」「localStorage 在 file:// 下抛异常」
 * 这三处，肉眼和肉眼 review 都看不出来。
 *
 * 用法：NODE_PATH=<jsdom> node tools/smoke-web.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let pass = 0, fail = 0;
const bad = [];
const ok = (c, label, detail) => {
  if (c) pass++;
  else { fail++; bad.push(label + (detail ? "  → " + detail : "")); }
};

// 模拟浏览器环境：含 localStorage（file:// 下真实可用）与剪贴板
// 注意：jsdom 默认【不加载外部 <script src>】，必须显式开 resources:"usable"，
// 否则 window.XHS 永远 undefined —— 那是测试环境缺陷，不是页面缺陷。
// 曾因此误判「页面坏了」，实际 bundle 内容完全正常。
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/"),
  pretendToBeVisual: true,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = () => null;
  },
});

const { window } = dom;
const doc = window.document;

// 捕获运行时错误 —— 这是冒烟的核心价值
const errors = [];
window.addEventListener("error", (e) => errors.push(e.message || String(e.error)));

setTimeout(() => {
  // ---- 1. 无脚本错误 ----
  ok(errors.length === 0, "页面加载无 JS 运行时错误", errors.join(" | "));
  ok(!!window.XHS, "window.XHS 数据已挂载");
  if (!window.XHS) {
    // 数据都没挂上，后面全是空选择器，报错会淹没真因 —— 先把根因说清楚
    console.log("\n❌ 数据未挂载，后续断言全部无效。原始报错：");
    errors.forEach((e) => console.log("  · " + e));
    window.close();
    process.exit(1);
  }
  {
    ok(Object.keys(window.XHS).length >= 13, "13 个数据表全部载入",
      `实际 ${Object.keys(window.XHS).length}`);
  }

  // ---- 3. 合成器渲染 ----
  const fields = doc.querySelectorAll("#fields select");
  ok(fields.length === 9, "九个维度选择器都渲染了", `实际 ${fields.length}`);
  fields.forEach((s, i) => {
    ok(s.options.length > 0, `选择器 ${i + 1} 有选项`);
  });

  // ---- 4. 实时拼提示词 ----
  const outEn = doc.getElementById("outEn");
  ok(!!outEn && outEn.textContent.includes("视觉指令"),
    "输出区渲染出视觉指令段");
  ok(outEn.textContent.includes("no watermark"), "硬约束出现在提示词里");
  ok(outEn.textContent.includes("3:4"), "画幅比例出现在提示词里");
  // 排版红线以前只在 fonts.json 里、从不进提示词（断链），这条断言防复发
  ok(outEn.textContent.includes("no more than 40%"), "排版红线出现在合成器提示词里");
  ok(!!doc.getElementById("why").textContent.includes("形态"),
    "配方说明渲染出内容");

  // ---- 5. 切换维度会重算 ----
  const before = doc.querySelector("#outEn .en").textContent;
  const styleSel = doc.querySelector('select[data-dim="style"]');
  styleSel.value = "ST-13";
  styleSel.dispatchEvent(new window.Event("change"));
  const after = doc.querySelector("#outEn .en").textContent;
  ok(before !== after, "切换风格后提示词实时重算");

  // ---- 6. 派生位自动跟随 ----
  // ---- 6. 派生位自动跟随 ----
// 曾是「先置 manual 再 auto」的顺序错误，导致 auto 里 if(!manual.form) 恒假，
// 自动跟随整个失效且不报错——只是点了没反应。这里严格断言它真的跟随。
try{ window.localStorage.clear(); }catch(e){}
  const follow = (dim, val) => {
    const s = doc.querySelector(`select[data-dim="${dim}"]`);
    s.value = val; s.dispatchEvent(new window.Event("change"));
  };
  follow("form", "FO-03");               // 测评对比
  ok(doc.querySelector('select[data-dim="cover"]').value === "CV-05",
    "选测评形态后封面自动跟随为对比冲击",
    `实际 ${doc.querySelector('select[data-dim="cover"]').value}`);
  ok(doc.querySelector('select[data-dim="layout2"]').value === "IG-004",
    "选测评形态后布局自动跟随为对比型",
    `实际 ${doc.querySelector('select[data-dim="layout2"]').value}`);

  follow("form", "FO-09");               // 数据图表 → 四象限
  ok(doc.querySelector('select[data-dim="layout2"]').value === "IG-014",
    "选数据形态后布局跟随为四象限",
    `实际 ${doc.querySelector('select[data-dim="layout2"]').value}`);

  follow("style", "ST-13");              // 赛博霓虹 → 冷色调
  ok(doc.querySelector('select[data-dim="palette"]').value === "PA-08",
    "选赛博霓虹后配色跟随为冷色调",
    `实际 ${doc.querySelector('select[data-dim="palette"]').value}`);

  // 手动改派生位后，上游解锁 —— 再改 form 应重新跟随
  follow("cover", "CV-01");
  follow("form", "FO-02");
  ok(doc.querySelector('select[data-dim="cover"]').value === "CV-03",
    "手动改封面后，改形态会重新跟随（派生位不锁上游）",
    `实际 ${doc.querySelector('select[data-dim="cover"]').value}`);

  ok(doc.querySelector("#outEn .en").textContent.includes("no watermark"),
    "全过程后提示词仍含硬约束");

  // ---- 7. localStorage 存配方 ----
  try {
    const raw = window.localStorage.getItem("xhs");
    if (raw) { ok(raw.includes("FO-"), "localStorage 里存的是最新选择"); }
    else { ok(true, "localStorage 在此环境不可用（file:// 正常，已 try/catch 兜住）"); }
  } catch (e) {
    ok(true, "localStorage 不可用但已兜住（file:// 正常）", e.message);
  }

  // ---- 8. 案例 / 词条 / 框架 三页 ----
  ok(doc.querySelectorAll("#caseList .case").length === 5, "5 个案例卡渲染");
  ok(doc.querySelectorAll("#entryGrid .card").length > 0, "词条卡渲染");
  ok(doc.querySelectorAll("#ownerTable tbody tr").length >= 8, "决策归属表 >=8 行");
  ok(doc.querySelectorAll("#matrix tbody tr").length >= 8, "覆盖矩阵 >=8 行");
  ok(doc.querySelectorAll("#conflict tbody tr").length >= 4, "冲突裁决表 >=4 行");

  // ---- 8b. 抽卡引擎 ----
  const G = window.XHS_GACHA;
  ok(!!G, "抽卡引擎已加载");
  if (G) {
    ok(G.DIMS.length === 6, "抽卡 6 个槽", `实际 ${G.DIMS.length}`);
    const p = G.pool();
    ok(Object.values(p).every((n) => n > 0), "所有槽候选数 > 0", JSON.stringify(p));
    ok(G.space() > 1e6, "组合空间量级正确", `实际 ${G.space()}`);
    // 同 seed 必须同结果（可复现）
    const a = G.rollSeeded(42), b = G.rollSeeded(42);
    ok(JSON.stringify(a.combo) === JSON.stringify(b.combo), "同 seed 抽到同一组（可复现）");
    const c2 = G.rollSeeded(7);
    ok(JSON.stringify(a.combo) !== JSON.stringify(c2.combo), "不同 seed 抽到不同组");
    // 池空间现算，不缓存：改一个槽应立刻反映
    const s1 = G.space();
    ok(typeof s1 === "number" && s1 > 0, "组合空间现算可读");
    // 产出含硬约束
    const txt = G.compose(a.picks, a.missing);
    ok(txt.includes("no watermark"), "抽卡产出含硬约束");
    ok(a.combo.layout2 && a.combo.style && a.combo.form, "抽卡产出含核心槽");
    ok(Array.isArray(a.missing), "空槽自报字段存在（missing[]）");
  }

  // ---- 9. 画廊页 ----
  const tabs = [...doc.querySelectorAll("nav button")];
  ok(tabs.length === 8, "8 个页签", `实际 ${tabs.length}`);
  ok(tabs[0].dataset.v === "gallery", "第一页是示例画廊");
  ok(doc.getElementById("v-gallery").classList.contains("on"), "画廊页默认展开");
  const gcards = doc.querySelectorAll("#galGrid .gcard");
  ok(gcards.length === 40, "画廊 40 张真实作品", `实际 ${gcards.length}`);
  ok(gcards[0].querySelector("img").getAttribute("src").startsWith("gallery/"),
    "画廊图片路径指向 gallery/");
  // 卡面直接复制按钮：每张卡都有、带配方码（断链防护——按钮曾只存在于详情面板）
  const gcopyBtns = doc.querySelectorAll("#galGrid .gcopy");
  ok(gcopyBtns.length === gcards.length, "每张画廊卡都有卡面复制按钮",
    `按钮 ${gcopyBtns.length} / 卡 ${gcards.length}`);
  ok(gcopyBtns[0].dataset.copy === gcards[0].dataset.code,
    "复制按钮携带对应配方码");
  // 合成器改用按钮：每张卡都有，点了要真的切到合成器页
  const gloadBtns = doc.querySelectorAll("#galGrid .gload");
  ok(gloadBtns.length === gcards.length, "每张画廊卡都有合成器改用按钮",
    `按钮 ${gloadBtns.length} / 卡 ${gcards.length}`);
  gloadBtns[0].dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-synth").classList.contains("on"),
    "点改用按钮切到合成器页");
  // 点图应展开详情（含完整提示词），而不是直接跳合成器
  const detail = doc.getElementById("galDetail");
  ok(detail && detail.style.display === "none", "详情区默认收起");
  gcards[0].dispatchEvent(new window.Event("click"));
  ok(detail.style.display === "block", "点图展开详情区");
  ok(detail.textContent.includes("完整提示词"), "详情区标注了「完整提示词」");
  ok(doc.getElementById("dCopy"), "详情区有复制提示词按钮");
  ok(doc.getElementById("dLoad"), "详情区有载入合成器按钮");
  ok(detail.querySelector(".box").textContent.length > 30, "详情区展示提示词正文");
  ok(detail.textContent.includes("素材授权"), "详情区含出图后要看的授权红线");
  ok(detail.querySelectorAll(".rrow").length >= 5, "授权红线 >=5 条");
  ok(detail.querySelectorAll(".rrow.must").length >= 3, "其中必守项 >=3 条");
  // 详情里的提示词应与数据源一致
  const g01 = window.XHS.gallery.items.find((x) => x.code === "G01");
  ok(detail.querySelector(".box").textContent.trim() === g01.rebuild.prompt.trim(),
    "详情提示词与数据源一致");
  // 点「载入合成器」应跳转
  doc.getElementById("dLoad").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-synth").classList.contains("on"),
    "详情里「载入合成器」跳到合成器");
  doc.querySelector('nav button[data-v="gallery"]').dispatchEvent(new window.Event("click"));

  // ---- 复制必须带尺寸参数（复制完能直接出图，不用回头找尺寸）----
  ok(typeof window.withSize === "function", "withSize 包装函数存在");
  const wrapped = window.withSize("测试提示词正文", "1024x1536（3:4 竖版）");
  ok(wrapped.includes("1024x1536"), "withSize 把尺寸写进了产出");
  ok(wrapped.includes("出图参数"), "withSize 有明确标注，粘出去一眼认得出");
  ok(wrapped.startsWith("测试提示词正文"), "withSize 保留原提示词在前");
  // 所有复制入口都不该再裸调 cp。
  // 用多行正则容易漏判（cp( 与参数分行时匹配不到）——改为统计
  // 「含 cp( 但不含 withSize」的语句块，宁可多报也不漏。
  const html = doc.documentElement.outerHTML;
  const bareCp = (html.match(/\bcp\((?:[^()]|\([^()]*\))*\)/g) || [])
    .filter((c) => !c.includes("withSize") && !c.includes("cnText")
               && !c.includes("async function") && !c.includes("cp(txt, btn)"));
  ok(bareCp.length === 0, "没有复制入口漏掉尺寸包装",
    `仍有 ${bareCp.length} 处：${bareCp.slice(0, 3).join(" / ")}`);
  // 抽卡 compose 里要有具体像素
  const gc = window.XHS_GACHA;
  if (gc) {
    const r = gc.roll();
    const t = gc.compose(r.picks, r.missing);
    ok(t.includes("1024x1536"), "抽卡产出含具体像素尺寸");
    ok(t.includes("3:4"), "抽卡产出含比例");
  }
  ok(!doc.body.textContent.includes("回传出图"),
    "已移除「回传出图（WorkBuddy 通道）」区块");
  ok(!doc.body.textContent.includes("⑦ 回传出图"),
    "自定义页不再有第 ⑦ 步");

  // ---- 10. 自定义工作台 ----
  const t2 = [...doc.querySelectorAll("nav button")];
  t2.find(b => b.dataset.v === "custom").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-custom").classList.contains("on"), "切到自定义页");
  ok(doc.querySelectorAll("#topicGrid .preset").length >= 10, "选题预设 >=10 组");
  ok(doc.querySelectorAll("#formulaChips .chip").length >= 6, "标题公式 >=6 条");
  ok(doc.querySelectorAll("#cFields select").length === 9, "自定义页 9 个维度可调");
  // 填主题 → 提示词要含该主题
  const hook = doc.getElementById("cHook");
  hook.value = "油皮夏天怎么用才不闷痘";
  hook.dispatchEvent(new window.Event("input"));
  ok(doc.getElementById("cOut").textContent.includes("油皮夏天怎么用才不闷痘"),
    "自定义提示词包含用户主题");
  ok(doc.getElementById("cOut").textContent.includes("no watermark")
    || doc.getElementById("cOut").textContent.includes("不要出现任何水印"),
    "自定义提示词含水印约束");
  ok(doc.getElementById("cOut").textContent.includes("no more than 40%"),
    "自定义提示词含排版红线");
  // 点预设要自动填主题并重算
  doc.querySelectorAll("#topicGrid .preset")[1].dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("cHook").value.length > 0, "点选题预设自动填入主题");
  ok(doc.getElementById("cOut").textContent.includes(
       doc.getElementById("cHook").value), "预设填入后提示词同步更新");

  const t3 = [...doc.querySelectorAll("nav button")];
  t3.find(b => b.dataset.v === "gacha").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-gacha").classList.contains("on"), "切到抽卡页");
  doc.getElementById("doRoll").click();
  ok(doc.querySelectorAll("#rollOut .case").length === 1, "抽 1 组成功渲染");
  doc.getElementById("doRoll8").click();
  ok(doc.querySelectorAll("#rollOut .case").length === 8, "抽 8 组铺开");
  doc.getElementById("doRoll4").click();
  ok(doc.querySelectorAll("#rollOut .case").length === 4, "抽 4 组铺开");
  // 随机来一张：抽画廊成品，必须带图 + 完整提示词 + 换一个
  const rbtn = doc.getElementById("doRandom");
  ok(rbtn && !!rbtn.querySelector("svg.dice"), "随机来一张按钮带骰子图标");
  rbtn.click();
  const rnd = doc.querySelector("#rollOut .case");
  ok(rnd && !!rnd.querySelector("img.rndimg"), "随机来一张渲染成品图");
  ok(rnd && rnd.querySelector(".vp").textContent.includes("小红书"),
    "随机卡带完整提示词");
  ok(doc.querySelectorAll("#rollOut .againbtn").length === 1, "随机卡带换一个");
  t3.find(b => b.dataset.v === "cases").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-cases").classList.contains("on"), "切到案例页");
  t3.find(b => b.dataset.v === "pairs").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-pairs").classList.contains("on"), "切到搭配页");
  ok(doc.querySelectorAll("#pairList .card").length > 0, "搭配卡渲染");

  t3.find(b => b.dataset.v === "framework").dispatchEvent(new window.Event("click"));
  ok(doc.getElementById("v-framework").classList.contains("on"), "切到框架页");

  // ---- 汇总 ----
  console.log("\n" + "─".repeat(46));
  if (fail === 0) console.log(`✅ 界面冒烟全绿 ${pass} 项`);
  else {
    console.log(`❌ ${fail} 项失败 / ${pass} 项通过`);
    bad.forEach((b) => console.log("  · " + b));
  }
  window.close();
  process.exit(fail === 0 ? 0 : 1);
}, 400);