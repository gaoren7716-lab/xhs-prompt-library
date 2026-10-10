/**
 * 措辞查重核心 —— 借鉴方法论不抄表达
 *
 * 独立成模块的原因：体检（check_cases.js）与命令行（check_copy.js）共用同一份判据，
 * 避免两处实现漂移。体检里不能 spawn 子进程调命令行版（Windows 同进程 spawn 会 EBUSY
 * 且拿不到 stdout，实测踩过），所以两边都 require 这个文件。
 */
"use strict";
const fs = require("fs");
const path = require("path");

/**
 * @param {string} root 项目根目录
 * @returns {{verdict:string,total:number,scanned:number,details:Array}}
 */
function checkCopy(root) {
  const toolsDir = __dirname;
  const refPath = path.join(toolsDir, "ref-samples.json");
  const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));

  const SCAN = [
    "data/rights.json", "data/gallery.json", "data/custom.json",
    "data/forms.json", "data/covers.json", "data/layouts.json",
    "data/styles.json", "data/palettes.json", "data/fonts.json",
    "data/decor.json", "data/sizes.json", "data/stylepair.json",
    "FRAMEWORK.md", "README.md", "怎么用.md", "吸收了什么.md",
  ];

  const generic = new Set(ref.allowedGeneric);

  // 只看 ≥5 字的完整表达。碎片比对会把「把一个概」这种无意义命中算进来，
  // 工具一旦噪音大，人就会忽略它 —— 那等于没有工具。
  function fullExpressions(text) {
    const out = [];
    const re = /[一-龥]{5,}/g;
    let m;
    while ((m = re.exec(text))) out.push(m[0]);
    return out;
  }

  const refFull = new Map();
  for (const s of ref.samples) {
    for (const f of fullExpressions(s.text)) {
      if (generic.has(f)) continue;
      if (!refFull.has(f)) refFull.set(f, s.src);
    }
  }

  let scanned = 0;
  const details = [];
  for (const rel of SCAN) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    scanned++;
    const seen = new Set();
    for (const f of fullExpressions(fs.readFileSync(p, "utf8"))) {
      if (generic.has(f) || !refFull.has(f)) continue;
      const key = f + "@" + rel;
      if (seen.has(key)) continue;
      seen.add(key);
      details.push({ frag: f, file: rel, src: refFull.get(f) });
    }
  }

  const total = details.length;
  return {
    verdict: total === 0 ? "PASS" : (total <= 3 ? "WARN" : "FAIL"),
    total, scanned, details,
    samples: ref.samples.length,
    whitelist: generic.size,
  };
}

module.exports = { checkCopy };