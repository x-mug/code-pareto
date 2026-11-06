#!/usr/bin/env node
// 只读报告目录结构与数据异常，数量和数值偏差仅告警。
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_PATH = fileURLToPath(new URL("../src/data/catalog.json", import.meta.url));

const PILLARS = ["coding", "akw", "science", "reasoning", "knowledge"];

// 跨快照成本偏差超过此值时告警。
const COST_WARNING_THRESHOLD = 0.1;

/**
 * 以下与 src/lib/view-logic.ts 保持一致（本脚本是 .mjs，不能直接 import TS）。
 * 只用来统计"每个视角有多少模型可上散点图"。
 */
const VIEW_PRESETS = {
  coding: { coding: 1 },
  codingEngineering: { coding: 0.6, akw: 0.4 },
  aaEngineering: { knowledge: 0.3, science: 0.2, reasoning: 0.2, coding: 0.15, akw: 0.15 },
};
const DEFAULT_CUSTOM_WEIGHTS = { coding: 0.6, akw: 0.4, science: 0, reasoning: 0, knowledge: 0 };

const results = [];

function pass(name, detail) {
  results.push({ level: "pass", name, detail });
}

function fail(name, detail) {
  results.push({ level: "fail", name, detail });
}

function warn(name, detail) {
  results.push({ level: "warn", name, detail });
}

function note(name, detail) {
  results.push({ level: "note", name, detail });
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableNumber(value) {
  return value === null || isFiniteNumber(value);
}

function isComparable(model) {
  return (
    isFiniteNumber(model.intelligence) &&
    isFiniteNumber(model.costPerTask) &&
    model.costPerTask > 0
  );
}

function normalizeWeights(input) {
  const out = {};
  let sum = 0;
  for (const pillar of PILLARS) {
    const value = Number(input[pillar]);
    out[pillar] = Number.isFinite(value) && value > 0 ? value : 0;
    sum += out[pillar];
  }
  if (sum <= 0) return null;
  for (const pillar of PILLARS) out[pillar] /= sum;
  return out;
}

/** 镜像 view-logic.ts 的 applyView：返回该视角下的得分与成本，null 表示不可比较 */
function applyView(model, weights) {
  if (!weights) {
    return isComparable(model) ? { score: model.intelligence, cost: model.costPerTask } : null;
  }
  const dimensions = model.dimensions;
  if (!dimensions?.pillars || !dimensions?.pillarCosts) return null;
  let score = 0;
  let cost = 0;
  for (const pillar of PILLARS) {
    const weight = weights[pillar];
    if (weight <= 0) continue;
    const pillarScore = dimensions.pillars[pillar];
    const pillarCost = dimensions.pillarCosts[pillar];
    if (!isFiniteNumber(pillarScore) || !isFiniteNumber(pillarCost)) return null;
    score += weight * pillarScore;
    cost += weight * pillarCost;
  }
  return cost > 0 ? { score, cost } : null;
}

function countComparable(models, presetWeights) {
  const weights = presetWeights ? normalizeWeights(presetWeights) : null;
  return models.filter((model) => applyView(model, weights) !== null).length;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatNumber(value, digits = 2) {
  if (!isFiniteNumber(value)) return "-";
  return value.toFixed(digits);
}

function printTable(rows) {
  const width = Math.max(...rows.map((row) => row[0].length));
  for (const [label, ...cells] of rows) {
    console.log("  " + label.padEnd(width) + "  " + cells.join("  "));
  }
}

function checkCatalogShape(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    problems.push("根节点不是对象");
    return problems;
  }
  if (!Array.isArray(catalog.models)) {
    problems.push("models 不是数组");
  }
  if (typeof catalog.syncedAt !== "string" || Number.isNaN(Date.parse(catalog.syncedAt))) {
    problems.push("syncedAt 不是合法时间字符串");
  }
  if (!isFiniteNumber(catalog.refreshIntervalMs)) {
    problems.push("refreshIntervalMs 不是数字");
  }
  if (catalog.indexVersion !== null && !isFiniteNumber(catalog.indexVersion)) {
    problems.push("indexVersion 既不是数字也不是 null");
  }
  if (!catalog.source || typeof catalog.source !== "object") {
    problems.push("source 缺失");
  } else {
    if (catalog.source.provider !== "Artificial Analysis") {
      problems.push("source.provider 不是 Artificial Analysis");
    }
    if (catalog.source.mode !== "live" && catalog.source.mode !== "demo") {
      problems.push("source.mode 不是 live/demo");
    }
  }
  return problems;
}

function checkModelShape(model) {
  const problems = [];
  if (typeof model.id !== "string" || model.id === "") problems.push("id");
  if (typeof model.slug !== "string" || model.slug === "") problems.push("slug");
  if (typeof model.name !== "string" || model.name === "") problems.push("name");
  if (typeof model.creator !== "string" || model.creator === "") problems.push("creator");
  if (model.creatorId !== null && typeof model.creatorId !== "string") problems.push("creatorId");
  if (model.releaseDate !== null && typeof model.releaseDate !== "string") problems.push("releaseDate");
  if (typeof model.reasoning !== "boolean") problems.push("reasoning");
  for (const field of [
    "intelligence",
    "coding",
    "agentic",
    "costPerTask",
    "inputPrice",
    "outputPrice",
    "blendedPrice",
    "outputSpeed",
    "latency",
  ]) {
    if (!isNullableNumber(model[field])) problems.push(field);
  }
  return problems;
}

/** 支柱完整性 + 成本为正 + 开源权重 */
function checkDimensions(models) {
  const problems = [];
  const dimensioned = models.filter((model) => model.dimensions);
  const withPillars = dimensioned.filter((model) => model.dimensions.pillars);
  const withCosts = dimensioned.filter((model) => model.dimensions.pillarCosts);
  const withOpenWeights = dimensioned.filter(
    (model) => typeof model.dimensions.openWeights === "boolean",
  );

  for (const model of withPillars) {
    const pillars = model.dimensions.pillars;
    for (const pillar of PILLARS) {
      const value = pillars[pillar];
      if (!isFiniteNumber(value) || value < 0 || value > 100) {
        problems.push(model.slug + ".pillars." + pillar + " 不是 0-100 的数字");
      }
    }
    const extraKeys = Object.keys(pillars).filter((key) => !PILLARS.includes(key));
    if (extraKeys.length > 0) {
      problems.push(model.slug + ".pillars 有额外字段 " + extraKeys.join(","));
    }
  }

  for (const model of withCosts) {
    const costs = model.dimensions.pillarCosts;
    for (const pillar of PILLARS) {
      const value = costs[pillar];
      if (!isFiniteNumber(value) || value <= 0) {
        problems.push(model.slug + ".pillarCosts." + pillar + " 不是正数");
      }
    }
    const extraKeys = Object.keys(costs).filter((key) => !PILLARS.includes(key));
    if (extraKeys.length > 0) {
      problems.push(model.slug + ".pillarCosts 有额外字段 " + extraKeys.join(","));
    }
  }

  for (const model of dimensioned) {
    if (!model.dimensions.pillars) {
      problems.push(model.slug + " 有 dimensions 却没有 pillars");
    }
    if (model.dimensions.pillarCosts === undefined) {
      problems.push(model.slug + " 的 pillarCosts 应为对象或 null");
    }
  }

  // 有支柱数据的模型默认视角也必须能画（否则切换视角时整条消失得很突兀）
  for (const model of withPillars) {
    if (!isFiniteNumber(model.intelligence)) {
      problems.push(model.slug + " 有支柱分数但综合分是 null");
    }
  }

  return { problems, dimensioned, withPillars, withCosts, withOpenWeights };
}

/** 支柱成本反算的每任务总成本 vs AA 官方 costPerTask */
function checkCostConsistency(models) {
  // 支柱权重 = 9 项评测在 Intelligence Index 里的权重之和（coding .25 / akw .15 / science .25 / reasoning .10 / knowledge .25）
  const EVAL_PILLAR_WEIGHTS = { coding: 0.25, akw: 0.15, science: 0.25, reasoning: 0.1, knowledge: 0.25 };
  let compared = 0;
  let worst = { deviation: 0, slug: null };
  for (const model of models) {
    const costs = model.dimensions?.pillarCosts;
    if (!costs || !isFiniteNumber(model.costPerTask) || model.costPerTask <= 0) continue;
    const recomputed = PILLARS.reduce(
      (sum, pillar) => sum + EVAL_PILLAR_WEIGHTS[pillar] * costs[pillar],
      0,
    );
    const deviation = Math.abs(recomputed - model.costPerTask) / model.costPerTask;
    compared += 1;
    if (deviation > worst.deviation) worst = { deviation, slug: model.slug };
  }
  return { compared, worst };
}

function printStats(models, dimensions) {
  const creators = new Set(models.map((model) => model.creator));
  const withIntelligence = models.filter((model) => isFiniteNumber(model.intelligence));
  const comparable = models.filter(isComparable);
  const scores = comparable.map((model) => model.intelligence);
  const costs = comparable.map((model) => model.costPerTask);

  console.log("");
  console.log("统计");
  printTable([
    ["模型总数", String(models.length)],
    ["厂商数", String(creators.size)],
    ["有 AA 综合分", String(withIntelligence.length)],
    ["综合视角可比较", String(comparable.length)],
    ["有 dimensions", String(dimensions.dimensioned.length)],
    ["  含支柱分数", String(dimensions.withPillars.length)],
    ["  含支柱成本", String(dimensions.withCosts.length)],
    ["  开源权重 true", String(dimensions.withOpenWeights.filter((model) => model.dimensions.openWeights === true).length)],
    ["综合分区间", formatNumber(Math.min(...scores), 1) + " - " + formatNumber(Math.max(...scores), 1)],
    ["每任务成本区间", "$" + formatNumber(Math.min(...costs), 3) + " - $" + formatNumber(Math.max(...costs), 2)],
  ]);

  console.log("");
  console.log("每视角可比较模型数");
  printTable([
    ["综合智能", String(countComparable(models, null))],
    ["纯编程", String(countComparable(models, VIEW_PRESETS.coding))],
    ["编程 + 工程", String(countComparable(models, VIEW_PRESETS.codingEngineering))],
    ["AA 工程指数", String(countComparable(models, VIEW_PRESETS.aaEngineering))],
    ["自定义（c0.6/a0.4）", String(countComparable(models, DEFAULT_CUSTOM_WEIGHTS))],
  ]);

  console.log("");
  console.log("支柱分布（" + dimensions.withCosts.length + " 个含成本的模型）");
  printTable([
    ["支柱", "分数 min/median/max", "成本 min/median/max (USD)"],
    ...PILLARS.map((pillar) => {
      const pillarScores = dimensions.withPillars
        .map((model) => model.dimensions.pillars[pillar])
        .filter(isFiniteNumber);
      const pillarCosts = dimensions.withCosts
        .map((model) => model.dimensions.pillarCosts[pillar])
        .filter(isFiniteNumber);
      return [
        pillar,
        [formatNumber(Math.min(...pillarScores)), formatNumber(median(pillarScores)), formatNumber(Math.max(...pillarScores))].join(" / "),
        [formatNumber(Math.min(...pillarCosts), 4), formatNumber(median(pillarCosts), 4), formatNumber(Math.max(...pillarCosts), 2)].join(" / "),
      ];
    }),
  ]);
}

function printResults() {
  console.log("");
  const marks = { pass: "✓", fail: "✗", warn: "!", note: "·" };
  for (const result of results) {
    console.log("  " + marks[result.level] + " " + result.name + "  " + result.detail);
    if (process.env.GITHUB_ACTIONS === "true" && result.level === "warn") {
      const message = (result.name + ": " + result.detail).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
      console.log("::warning::" + message);
    }
  }
}

async function main() {
  const path = process.argv[2] ? process.argv[2] : DEFAULT_PATH;
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    console.error("读取失败: " + path + "（先跑 node scripts/build-data.mjs）");
    process.exitCode = 1;
    return;
  }

  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (error) {
    console.error("解析失败: " + path + " -> " + error.message);
    process.exitCode = 1;
    return;
  }

  console.log("检查 " + path + "（" + (Buffer.byteLength(raw) / 1024).toFixed(1) + " KB）");

  const shapeProblems = checkCatalogShape(catalog);
  if (shapeProblems.length > 0) {
    fail("目录结构", shapeProblems.join("；"));
    printResults();
    process.exitCode = 1;
    return;
  }
  pass("目录结构", "models=" + catalog.models.length + " syncedAt=" + catalog.syncedAt + " indexVersion=" + catalog.indexVersion);

  const models = catalog.models;

  // 1. 模型数量
  if (models.length === 0) warn("模型数量", "本轮目录没有模型");
  else pass("模型数量", String(models.length));

  // 2. 唯一性
  const slugs = new Set();
  const ids = new Set();
  const duplicateSlugs = [];
  const duplicateIds = [];
  for (const model of models) {
    if (slugs.has(model.slug)) duplicateSlugs.push(model.slug);
    slugs.add(model.slug);
    if (ids.has(model.id)) duplicateIds.push(model.id);
    ids.add(model.id);
  }
  if (duplicateSlugs.length === 0 && duplicateIds.length === 0) {
    pass("id/slug 唯一", models.length + " 条");
  } else {
    fail("id/slug 唯一", "重复 slug=" + duplicateSlugs.join(",") + " 重复 id=" + duplicateIds.join(","));
  }

  // 3. 单条记录字段契约
  const modelProblems = [];
  for (const model of models) {
    const problems = checkModelShape(model);
    if (problems.length > 0) modelProblems.push(model.slug + ": " + problems.join(","));
    if (modelProblems.length >= 5) break;
  }
  if (modelProblems.length === 0) {
    pass("模型字段契约", "id/slug/name/creator/reasoning + 9 个可空数字字段");
  } else {
    fail("模型字段契约", modelProblems.join("；"));
  }

  // 4. 综合视角可比较数量
  const comparable = models.filter(isComparable);
  if (comparable.length === 0) warn("综合视角可比较", "本轮没有可绘制的模型");
  else pass("综合视角可比较", String(comparable.length));

  // 5. dimensions 覆盖 + 支柱完整性 + 成本为正
  const dimensions = checkDimensions(models);
  if (dimensions.problems.length === 0) {
    pass("dimensions 契约", "pillars/pillarCosts/openWeights 字段齐全类型正确");
  } else {
    warn("dimensions 契约", dimensions.problems.slice(0, 8).join("；"));
  }

  note("dimensions 覆盖", dimensions.dimensioned.length + " 个模型");
  if (dimensions.dimensioned.length === 0) {
    warn("支柱完整性", "没有任何模型带 dimensions");
  } else if (dimensions.withPillars.length === dimensions.dimensioned.length) {
    pass("支柱完整性", dimensions.withPillars.length + " 个模型 5 支支柱齐全");
  } else {
    warn("支柱完整性", dimensions.withPillars.length + "/" + dimensions.dimensioned.length + " 个模型有完整支柱");
  }

  note("支柱成本覆盖", dimensions.withCosts.length + " 个模型有完整正成本");
  if (dimensions.withOpenWeights.length !== dimensions.dimensioned.length) {
    warn("openWeights 完整性", dimensions.withOpenWeights.length + "/" + dimensions.dimensioned.length + " 个模型有布尔 openWeights");
  } else {
    const openWeightsCount = dimensions.withOpenWeights.filter((model) => model.dimensions.openWeights).length;
    pass("openWeights 完整性", dimensions.withOpenWeights.length + " 个模型布尔值齐全，其中 true " + openWeightsCount + " 个");
  }

  // 6. 支柱成本 ↔ AA 官方 costPerTask 一致性
  const consistency = checkCostConsistency(models);
  if (consistency.compared === 0) {
    warn("成本反算一致性", "没有可交叉校验的模型");
  } else if (consistency.worst.deviation <= COST_WARNING_THRESHOLD) {
    pass(
      "成本反算一致性",
      consistency.compared + " 个模型，最大相对偏差 " + (consistency.worst.deviation * 100).toFixed(2) + "%",
    );
  } else {
    warn(
      "成本反算一致性",
      "最大相对偏差 " + (consistency.worst.deviation * 100).toFixed(2) + "% > " + COST_WARNING_THRESHOLD * 100 + "%（" + consistency.worst.slug + "）",
    );
  }

  // 7. 视角可比较数量：支柱视角必须等于有成本的模型数
  const viewCounts = {
    intelligence: countComparable(models, null),
    coding: countComparable(models, VIEW_PRESETS.coding),
    codingEngineering: countComparable(models, VIEW_PRESETS.codingEngineering),
    aaEngineering: countComparable(models, VIEW_PRESETS.aaEngineering),
    custom: countComparable(models, DEFAULT_CUSTOM_WEIGHTS),
  };
  const pillarViewCounts = [viewCounts.coding, viewCounts.codingEngineering, viewCounts.aaEngineering, viewCounts.custom];
  if (pillarViewCounts.every((count) => count === dimensions.withCosts.length)) {
    pass("视角可比较数量", "综合 " + viewCounts.intelligence + " / 4 个支柱视角均 " + dimensions.withCosts.length);
  } else {
    warn("视角可比较数量", JSON.stringify(viewCounts) + "，预期 4 个支柱视角均为 " + dimensions.withCosts.length);
  }

  // 8. 刷新间隔与 models.ts 常量一致（8 小时）
  if (catalog.refreshIntervalMs === 28800000) {
    pass("refreshIntervalMs", "8 小时");
  } else {
    warn("refreshIntervalMs", catalog.refreshIntervalMs + " 与 models.ts 的 8 小时不一致");
  }

  note("数据源", catalog.source.url + " / tier=" + catalog.source.tier + " / mode=" + catalog.source.mode);

  printStats(models, dimensions);
  printResults();

  const failures = results.filter((result) => result.level === "fail");
  const warnings = results.filter((result) => result.level === "warn");
  console.log("");
  if (failures.length > 0) {
    console.log("❌ check-data 无法确认目录结构：" + failures.length + " 项不通过");
    process.exitCode = 1;
  } else {
    console.log("✅ check-data 通过：" + results.filter((r) => r.level === "pass").length + " 项正常，" + warnings.length + " 项告警（不阻止更新）");
  }
}

main().catch((error) => {
  console.error("check-data 异常: " + (error instanceof Error ? error.stack : String(error)));
  process.exitCode = 1;
});