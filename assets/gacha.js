/**
 * 小红书提示词库 · 抽卡引擎
 * ============================================================
 * 抽卡 = 从各维度库存里各抽一条，凑成一组从没见过的组合。
 * 它不是「同一提示词换 seed」——那是同一张图看六遍。
 *
 * ------------------------------------------------------------
 * 吸收自 anime-prompt-library/assets/gacha.js 的三条硬约定
 * ------------------------------------------------------------
 * 1. **不改全局状态**。抽卡要同时持有多组组合，若把结果写进全局
 *    再读回来，会把用户当前选好的配方冲掉。抽卡是纯函数式产出。
 *
 * 2. **候选为 0 的槽必须自报**，不能静默跳过。少一层约束的提示词
 *    照样能出图，只是出的不是你要的东西 —— 这类「不报错、只是效果
 *    不对」的失败最难查。所以返回 missing[]，界面显式提示。
 *
 * 3. **不做加权、不排除已选**。抽卡的意义是看到没见过的组合；
 *    按「排除当前已选」过滤会把范围越压越窄，抽出来的东西越抽
 *    越像，那就失去抽卡的意义了。
 *
 * 另外一条来自池规模：**每次现算，不缓存**。缓存下来会在库升级后
 * 显示一个旧数字，而「数字停在旧规模上」看起来完全正常，只是它在说谎。
 */
"use strict";

const DIMS = [
  { k: "form",    zh: "内容形态", required: true },
  { k: "cover",   zh: "封面类型", required: false },
  { k: "layout2", zh: "排版图型", required: true },
  { k: "style",   zh: "视觉风格", required: true },
  { k: "palette2",zh: "主题色",   required: false },
  { k: "decor",   zh: "装饰元素", required: false },
];

const HARD = "no watermark, no logo, no deformed fingers, natural features";

/** 取依赖：浏览器读 window.XHS；Node 下由调用方先注入 window。
 *  不能写 typeof X !== "undefined" —— 同名 getter 会让它命中自己，递归到爆栈。
 *  也不 require data-bundle.js —— 它是浏览器脚本（赋值给 window.XHS），
 *  不是 CommonJS 模块，require 进来拿不到数据。
 *
 *  ⚠ 关键：DIMS.k 是【单数】维度标识（form/cover/layout2…），
 *    而 window.XHS 的键是【复数】表名（forms/covers/layouts165…），
 *    必须经 DATA_OF 映射。曾在这里重犯 index.html 当初的错 ——
 *    抽卡全返回空却不报错，只是「抽出来什么都是空的」。 */
const DATA_OF = { form:"forms", cover:"covers", layout2:"layouts165", style:"styles",
                 palette2:"palette36", decor:"decor" };

function g(dimKey) {
  const w = (typeof window !== "undefined") ? window
          : (typeof globalThis !== "undefined") ? globalThis : null;
  const XHS = w && w.XHS;
  if (!XHS) return null;
  const table = DATA_OF[dimKey];
  return table ? XHS[table] : null;
}

/** 池规模：每次现算，不缓存 */
function pool() {
  const out = {};
  for (const d of DIMS) {
    const t = g(d.k);
    out[d.k] = (t && t.items) ? t.items.length : 0;
  }
  return out;
}

/** 组合空间：各槽相乘。某槽为 0 则整体为 0（并由 roll 自报 missing） */
function space() {
  const p = pool();
  return Object.values(p).reduce((a, b) => a * b, 1);
}

/**
 * 抽一组。
 * @param {function} [rng] 可注入的随机源，便于同 seed 复现与测试
 * @returns {{combo:Object, picks:Object, missing:string[], space:number}}
 */
function roll(rng) {
  const r = rng || Math.random;
  const combo = {}, picks = {}, missing = [];

  for (const d of DIMS) {
    const t = g(d.k);
    const items = (t && t.items) ? t.items : [];
    if (!items.length) { missing.push(d.zh + "(" + d.k + ")"); continue; }
    const it = items[Math.floor(r() * items.length)];
    combo[d.k] = it.code;
    picks[d.k] = it;
  }
  return { combo, picks, missing, space: space() };
}

/** 组装成可复制的出图文本 */
function compose(picks, missing) {
  const order = ["style", "layout2", "decor", "palette2"];
  const parts = [];
  for (const k of order) {
    const it = picks[k];
    if (it && it.prompt) parts.push(it.prompt.trim());
  }
  parts.push("vertical 3:4 aspect ratio");
  // 尺寸写具体像素：只写「3:4」很多工具仍要手动猜分辨率
  parts.push("1024x1536 pixels");
  const en = parts.join(", ") + ", " + HARD;
  const lines = ["【小红书信息图 · 抽卡】"];
  lines.push("形态：" + (picks.form ? picks.form.zh : "(空槽)"));
  lines.push("封面：" + (picks.cover ? picks.cover.zh : "(空槽)"));
  lines.push("排版：" + (picks.layout2 ? picks.layout2.zh : "(空槽)"));
  lines.push("风格：" + (picks.style ? picks.style.zh : "(空槽)"));
  lines.push("主题色：" + (picks.palette2 ? picks.palette2.zh : "(空槽)"));
  lines.push("");
  lines.push(en);
  if (missing && missing.length) {
    lines.push("");
    lines.push("⚠ 空槽（未自报就出图会少约束）：" + missing.join("、"));
  }
  return lines.join("\n");
}

/** 批量抽 n 组 */
function rollMany(n, rng) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(roll(rng));
  return out;
}

// 浏览器挂全局，Node 走 module.exports
const API = { DIMS, HARD, pool, space, roll, rollMany, compose,
              rollSeeded: (seed) => rollMany(1, mulberry(seed))[0] };

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") window.XHS_GACHA = API;

/** 可复现的随机源（同 seed 同结果，便于测试与「抽到某组就固定」） */
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (typeof module !== "undefined" && module.exports) module.exports.mulberry = mulberry;