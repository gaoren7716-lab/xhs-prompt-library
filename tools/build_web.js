#!/usr/bin/env node
/**
 * xhs-prompt-library · 网页数据打包器
 *
 * 为什么需要这个：index.html 直接 fetch('data/*.json') 在 file:// 下会被浏览器
 * CORS 拦掉（本地文件不算同源）。所以把 JSON 合成一个 JS 变量用 <script> 引入，
 * 纯静态页就能双击打开，也能扔到任何静态托管上。
 *
 * 用法：node tools/build_web.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "assets");

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const FILES = [
  "forms", "covers", "layouts", "styles",
  "sizes", "palettes", "fonts", "decor",
  "recipes", "cases",
  // 精细图鉴
  "layouts165", "palette36", "stylepair",
  // 示例画廊 + 自定义工作台
  "gallery", "custom", "rights",
];

const bundle = {};
let total = 0;
for (const name of FILES) {
  const f = path.join(DATA, name + ".json");
  if (!fs.existsSync(f)) {
    console.error(`✗ 缺数据文件 ${name}.json`);
    process.exit(1);
  }
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  bundle[name] = j;
  // 有些表用 items / pairs / topicPresets / groups，计数口径要覆盖到
  const n = j.items ? j.items.length
          : j.pairs ? j.pairs.length
          : j.topicPresets ? j.topicPresets.length
          : 0;
  total += n;
  console.log(`  ${name.padEnd(9)} ${String(n).padStart(3)} 条`);
}

const js = `/* 自动生成，请勿手改。改数据请改 data/*.json 后重跑 node tools/build_web.js */\n` +
           `window.XHS = ${JSON.stringify(bundle)};\n`;

fs.writeFileSync(path.join(OUT, "data-bundle.js"), js, "utf8");
console.log(`\n✓ assets/data-bundle.js  ${(fs.statSync(path.join(OUT, "data-bundle.js")).size / 1024).toFixed(1)} KB · 共 ${total} 条目`);