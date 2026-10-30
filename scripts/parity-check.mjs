#!/usr/bin/env node
// 结构级 parity 校验：把本地构建产物与 parallax.zzz.sd 线上 SSR HTML 做 DOM/class 比对。
// 用法: node scripts/parity-check.mjs [本地文件或URL]，默认读 out/index.html，对比 https://parallax.zzz.sd/
import { readFile } from "node:fs/promises";

const LOCAL = process.argv[2] ?? "out/index.html";
const REMOTE = "https://parallax.zzz.sd/?parity=" + Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36";

async function loadLocal(path) {
  if (/^https?:/.test(path)) return await (await fetch(path, { headers: { "user-agent": UA } })).text();
  return readFile(path, "utf8");
}

function classSet(html) {
  const set = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) set.add(c);
  }
  return set;
}

const NOISE = /^(is-|has-|echarts|css-|jsx-)/;
function structural(set) {
  return new Set([...set].filter((c) => !NOISE.test(c) && c.length > 2));
}

const SECTIONS = [
  ["site-header", /class="site-header[\s"]/],
  ["hero", /class="hero[\s"]/],
  ["hero__stats", /class="hero__stats"/],
  ["explorer", /class="explorer[\s"]/],
  ["creator-legend", /class="creator-legend"/],
  ["recommendations", /class="recommendations[\s"]/],
  ["chart-card", /class="chart-card[\s"]/],
  ["decision-panel", /class="decision-panel[\s"]/],
  ["site-footer", /class="site-footer[\s"]/],
  ["recommendations__formula", /class="recommendations__formula/],
];

const [localHtml, remoteHtml] = await Promise.all([loadLocal(LOCAL), loadLocal(REMOTE)]);
const local = structural(classSet(localHtml));
const remote = structural(classSet(remoteHtml));
const missing = [...remote].filter((c) => !local.has(c)).sort();
const extra = [...local].filter((c) => !remote.has(c)).sort();

console.log("本地:", LOCAL, "(" + localHtml.length + " chars)");
console.log("线上: https://parallax.zzz.sd/ (" + remoteHtml.length + " chars)");
console.log("原版结构类名: " + remote.size + " | 本地覆盖: " + (remote.size - missing.length) + " | 缺失: " + missing.length);
console.log("覆盖率: " + (((remote.size - missing.length) / remote.size) * 100).toFixed(1) + "%");
if (missing.length) console.log("\n缺失类名:\n  " + missing.join("\n  "));
if (extra.length) console.log("\n新增类名（预期内）: " + extra.length + " 个\n  " + extra.slice(0, 40).join("\n  "));

console.log("\n关键区块:");
let sectionFail = 0;
for (const [name, re] of SECTIONS) {
  const okLocal = re.test(localHtml);
  const okRemote = re.test(remoteHtml);
  if (!okLocal && okRemote) sectionFail++;
  console.log("  " + (okLocal ? "OK  " : "MISS") + " " + name + (okRemote ? "" : "（线上无，跳过）"));
}

process.exit(missing.length === 0 && sectionFail === 0 ? 0 : 1);
