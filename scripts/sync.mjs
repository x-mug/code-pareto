#!/usr/bin/env node
// 从 Artificial Analysis 公开页面抓取模型数据，生成 site/data.js
// 用法: node scripts/sync.mjs
import { readFile, writeFile } from "node:fs/promises";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const PAGES = {
  intelligence: "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index",
  engineering: "https://artificialanalysis.ai/indexes/engineering",
};

// AA 前端把模型数据塞进 Next.js RSC 流，这里把 "initialModels" 数组抠出来
function extractInitialModels(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { chunks.push(JSON.parse(m[1])); } catch {}
  }
  const stream = chunks.join("");
  const idx = stream.indexOf('"initialModels":');
  if (idx < 0) throw new Error("initialModels not found in RSC payload");
  const start = stream.indexOf("[", idx);
  let depth = 0, end = -1;
  for (let i = start; i < stream.length; i++) {
    const c = stream[i];
    if (c === "[") depth++;
    else if (c === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error("unbalanced initialModels array");
  return JSON.parse(stream.slice(start, end + 1));
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
  return await r.text();
}

// AA 的评测元数据（任务数 / 在 Intelligence Index 里的权重），来自其前端 chunk
const EVALS = {
  frontierCode20:           { tokens: "frontierCode20",           tasks: 132,  weight: 0.15, name: "FrontierCode 2.0",        pillar: "coding" },
  terminalBench40:          { tokens: "terminalBench40",          tasks: 66,   weight: 0.10, name: "Terminal-Bench 4.0",       pillar: "coding" },
  terminalBenchScience:     { tokens: "terminalBenchScience",     tasks: 70,   weight: 0.15, name: "Terminal-Bench-Science",   pillar: "science" },
  critptAgenticHard:        { tokens: "critptAgenticHard",        tasks: 40,   weight: 0.10, name: "CritPt v2 (Hard)",         pillar: "science" },
  hleDiamond:               { tokens: "hleDiamond",               tasks: 1000, weight: 0.10, name: "HLE-Diamond",              pillar: "reasoning" },
  omniscience:              { tokens: "omniscience",              tasks: 3000, weight: 0.15, name: "AA-Omniscience v1.1",      pillar: "knowledge" },
  briefcaseElo:             { tokens: "briefcase",                tasks: 91,   weight: 0.15, name: "AA-Briefcase v1.1",        pillar: "akw" },
  automationBenchPartialScore:{ tokens: "automationBench",        tasks: 657,  weight: 0.05, name: "AutomationBench-AA",       pillar: "knowledge" },
  gdpPdfAllPass:            { tokens: "gdpPdf",                   tasks: 100,  weight: 0.05, name: "GDP.pdf",                  pillar: "knowledge" },
};

// 复刻 AA 的 "cost per task": 每条评测 token 成本 / 任务数，再按权重加权
function evalCostUSD(tok, model) {
  if (!tok) return null;
  const pin = model.price1mInputTokens;
  const pout = model.price1mOutputTokens;
  if (pin == null || pout == null) return null;
  const hitPrice = model.cacheHitPrice ?? pin * 0.25;
  const writePrice = model.cacheWritePrice ?? pin;      // 无 cache write 价格时按输入价估
  const hitRate = model.cacheHitRate ?? 0;
  const cacheable = tok.cacheableInput ?? 0;
  const nonCache = Math.max(0, tok.input - cacheable);
  const usd =
    nonCache * pin +
    cacheable * hitRate * hitPrice +
    cacheable * (1 - hitRate) * writePrice +
    (tok.answer + tok.reasoning) * pout;
  return usd / 1e6;
}

// 每个能力支柱的"每任务成本" = 支柱内评测按 Intelligence Index 权重的加权平均
const PILLARS = ["knowledge", "science", "reasoning", "coding", "akw"];
function pillarCosts(model) {
  const out = {};
  for (const p of PILLARS) {
    const evs = Object.values(EVALS).filter((e) => e.pillar === p);
    let num = 0, den = 0;
    for (const e of evs) {
      const tok = model.canonicalEvalTokenCounts?.[e.tokens];
      const c = evalCostUSD(tok, model);
      if (c == null) continue;
      num += (c / e.tasks) * e.weight;
      den += e.weight;
    }
    out[p] = den > 0 ? num / den : null;
  }
  return out;
}

function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

async function main() {
  console.log("抓取 Artificial Analysis 页面 ...");
  const [htmlIntel, htmlEng] = await Promise.all([
    fetchText(PAGES.intelligence),
    fetchText(PAGES.engineering),
  ]);
  const intelModels = extractInitialModels(htmlIntel);
  const engModels = extractInitialModels(htmlEng);
  const engById = new Map(engModels.map((m) => [m.id, m]));
  console.log("Intelligence 页 " + intelModels.length + " 个模型，Engineering 页 " + engModels.length + " 个模型");

  // 拿 parallax 的同源快照做 AA 官方"每任务成本"的交叉校验（免费 API 字段）
  let catalogBySlug = new Map();
  try {
    const r = await fetch("https://parallax.zzz.sd/api/models", { headers: { "user-agent": UA } });
    if (r.ok) {
      const j = await r.json();
      catalogBySlug = new Map((j.models || []).map((m) => [m.slug, m]));
      console.log("Parallax 快照 " + catalogBySlug.size + " 条，用于核对 costPerTask");
      var catalogSyncedAt = j.syncedAt;
    }
  } catch (e) {
    console.warn("Parallax 快照不可用，跳过交叉校验: " + e.message);
  }

  const models = intelModels.map((m) => {
    const eng = engById.get(m.id);
    const cat = catalogBySlug.get(m.slug);
    const pc = pillarCosts(m);
    const sub = eng?.subScores ?? {};
    const aaCostPerTask = cat?.costPerTask ?? null;
    return {
      id: m.id,
      slug: m.slug,
      name: m.shortName || m.name,
      fullName: m.name,
      creator: m.creator?.name ?? "Unknown",
      creatorSlug: m.creator?.slug ?? "unknown",
      color: m.creator?.color ?? "#888",
      releaseDate: m.releaseDate,
      isReasoning: !!m.isReasoning,
      isOpenWeights: !!m.isOpenWeights,
      deprecated: !!m.deprecated,
      sizeClass: m.sizeClass,
      // 0-100 的能力支柱
      subScores: {
        knowledge: round(sub.knowledge),
        science: round(sub.science),
        reasoning: round(sub.reasoning),
        coding: round(sub.agenticTerminalUse),
        akw: round(sub.agenticKnowledgeWork),
      },
      // 原始分（0-100 便于读）
      raw: {
        frontierCode: round(m.frontierCode20 == null ? null : m.frontierCode20 * 100),
        terminalBench: round(m.terminalBench40 == null ? null : m.terminalBench40 * 100),
        terminalBenchScience: round(m.terminalBenchScience == null ? null : m.terminalBenchScience * 100),
        critpt: round(m.critptAgenticHard == null ? null : m.critptAgenticHard * 100),
        hle: round(m.hleDiamond == null ? null : m.hleDiamond * 100),
        omniscience: round(m.omniscience),
        briefcaseElo: round(m.briefcaseElo, 0),
        automationBench: round(m.automationBenchPartialScore == null ? null : m.automationBenchPartialScore * 100),
        gdpPdf: round(m.gdpPdfAllPass == null ? null : m.gdpPdfAllPass * 100),
      },
      // 成本：AA 官方口径 + 我们按支柱拆分的每任务成本
      aaIndex: round(m.intelligenceIndex),
      aaIndexCostPerTask: round(aaCostPerTask),
      aaEngineeringIndex: round(eng?.weightedIndex),
      aaEngineeringCostPerTask: round(eng?.costPerTask?.total),
      pillarCost: Object.fromEntries(PILLARS.map((p) => [p, round(pc[p], 3)])),
      outputTokensPerTask: round(eng?.outputTokensPerTask?.output, 0),
      timePerTaskSeconds: round(eng?.timePerTaskSeconds, 0),
    };
  }).filter((m) => m.subScores.coding != null);

  const out = {
    generatedAt: new Date().toISOString(),
    catalogSyncedAt: typeof catalogSyncedAt === "string" ? catalogSyncedAt : null,
    sources: [
      { name: "Artificial Analysis Intelligence Index v5", url: PAGES.intelligence },
      { name: "Artificial Analysis Engineering Index", url: PAGES.engineering },
    ],
    evals: EVALS,
    pillars: {
      coding: "Agentic Coding（FrontierCode 2.0 + Terminal-Bench 4.0 等权）",
      akw: "Agentic Knowledge Work（AA-Briefcase）",
      science: "Science（CritPt v2 Hard + Terminal-Bench-Science）",
      reasoning: "Reasoning（HLE-Diamond）",
      knowledge: "Knowledge（AA-Omniscience + GDP.pdf + AutomationBench）",
    },
    models: models.sort((a, b) => (b.subScores.coding ?? 0) - (a.subScores.coding ?? 0)),
  };

  const target = new URL("../data.js", import.meta.url);
  const next = "window.AA_DATA = " + JSON.stringify(out, null, 2) + ";\n";
  let prev = "";
  try { prev = await readFile(target, "utf8"); } catch {}
  if (prev) {
    try {
      const pj = JSON.parse(prev.replace(/^window\.AA_DATA = /, "").replace(/;\s*$/, ""));
      // 只有模型数据或权重真变了才写文件，避免定时任务刷出无意义提交
      if (JSON.stringify(pj.models) === JSON.stringify(out.models) && JSON.stringify(pj.evals) === JSON.stringify(out.evals)) {
        console.log("模型数据无变化，保留原 data.js（不产生提交）");
        return;
      }
    } catch {}
  }
  await writeFile(target, next, "utf8");
  console.log("写入 data.js: " + models.length + " 个模型");
}

main().catch((e) => {
  console.error("同步失败:", e);
  process.exit(1);
});
