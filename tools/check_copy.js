#!/usr/bin/env node
/**
 * 措辞查重（命令行版）—— 借鉴方法论不抄表达
 *
 * 核心判据在 copy-core.js，体检那边也 require 同一份，避免两处漂移。
 *
 * 用法：node tools/check_copy.js
 */
"use strict";
const path = require("path");
const { checkCopy } = require("./copy-core.js");

const R = checkCopy(path.join(__dirname, ".."));

console.log("\n─── 措辞查重（借鉴方法论，不抄表达）───\n");
console.log(`扫描文件 ${R.scanned} 个 · 参照样本 ${R.samples} 条 · 公共词白名单 ${R.whitelist} 个`);
console.log(`雷同片段：${R.total} 个 → ${R.verdict}\n`);

if (R.details.length) {
  const byFrag = {};
  R.details.forEach((d) => { byFrag[d.frag] = byFrag[d.frag] || []; byFrag[d.frag].push(d); });
  Object.entries(byFrag).sort((a, b) => b[1].length - a[1].length)
    .slice(0, 25).forEach(([frag, ds]) => {
      console.log(`  「${frag}」 ×${ds.length}`);
      ds.slice(0, 3).forEach((d) => console.log(`      ${d.file}  ← 参照来源 ${d.src}`));
    });
}

console.log(`\n判据：`);
console.log(`  PASS  0 个  —— 表述完全自写`);
console.log(`  WARN  ≤3 个 —— 可能是行业通用说法，人工确认即可`);
console.log(`  FAIL  >3 个 —— 需改写表述，换成自己的说法`);
console.log(`\n说明：只比对 ≥5 字的完整表达；行业公共词已豁免。`);
console.log(`      碎片不算 —— 噪音大的工具等于没有工具。`);

process.exit(R.verdict === "FAIL" ? 1 : 0);