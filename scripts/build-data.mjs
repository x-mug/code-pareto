#!/usr/bin/env node
/**
 * 生成 src/data/catalog.json
 *
 * 1. 拉 Parallax 模型目录（https://parallax.zzz.sd/api/models，ModelCatalog 结构）
 * 2. 拉 AA Intelligence Index / Engineering Index 两个页面的 RSC payload（initialModels）
 * 3. 按 slug 给"跑完 AA 完整评测"的模型补 dimensions：
 *      pillars      ← Engineering 页 subScores（0-100，5 支支柱）
 *      pillarCosts  ← Intelligence 页 canonicalEvalTokenCounts × 官方价格复算的 USD/任务，
 *                     支柱内按 9 项评测在 Intelligence Index 里的权重加权
 *      openWeights  ← Intelligence 页 isOpenWeights
 * 4. 写 src/data/catalog.json（2 空格缩进、UTF-8），上游字段一律原样保留
 *
 * 幂等：输入不变时输出逐字节相同；任何一步失败都不会覆盖已有文件。
 * 用法: node scripts/build-data.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const SOURCES = {
  catalog: "https://parallax.zzz.sd/api/models",
  intelligence:
    "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index",
  engineering: "https://artificialanalysis.ai/indexes/engineering",
};

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/data/catalog.json", import.meta.url),
);

const PILLARS = ["coding", "akw", "science", "reasoning", "knowledge"];

/** AA Engineering Index 页 subScores 里的字段名 → 我们用的支柱 key */
const SUB_SCORE_FIELDS = {
  coding: "agenticTerminalUse",
  akw: "agenticKnowledgeWork",
  science: "science",
  reasoning: "reasoning",
  knowledge: "knowledge",
};

/**
 * AA 的 9 项评测：任务数 + 在 Intelligence Index v5 里的权重（合 1，取自 AA 前端数据）。
 * 权重同时决定支柱内每任务成本的加权平均口径。
 */
const EVALS = {
  frontierCode20: { tokens: "frontierCode20", tasks: 132, weight: 0.15, pillar: "coding" },
  terminalBench40: { tokens: "terminalBench40", tasks: 66, weight: 0.1, pillar: "coding" },
  terminalBenchScience: { tokens: "terminalBenchScience", tasks: 70, weight: 0.15, pillar: "science" },
  critptAgenticHard: { tokens: "critptAgenticHard", tasks: 40, weight: 0.1, pillar: "science" },
  hleDiamond: { tokens: "hleDiamond", tasks: 1000, weight: 0.1, pillar: "reasoning" },
  omniscience: { tokens: "omniscience", tasks: 3000, weight: 0.15, pillar: "knowledge" },
  briefcaseElo: { tokens: "briefcase", tasks: 91, weight: 0.15, pillar: "akw" },
  automationBenchPartialScore: {
    tokens: "automationBench",
    tasks: 657,
    weight: 0.05,
    pillar: "knowledge",
  },
  gdpPdfAllPass: { tokens: "gdpPdf", tasks: 100, weight: 0.05, pillar: "knowledge" },
};

/** AA 官方 Engineering Index 的支柱权重，用来反查 subScores 字段映射是否仍然成立 */
const ENGINEERING_WEIGHTS = {
  knowledge: 0.3,
  science: 0.2,
  reasoning: 0.2,
  coding: 0.15,
  akw: 0.15,
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
/** 复算的每任务总成本相对 AA 官方 costPerTask 的允许误差 */
const COST_TOLERANCE = 0.1;

function log(message) {
  console.log("[build-data] " + message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带重试的 HTTP GET。4xx 直接失败，其余错误重试 MAX_ATTEMPTS 次。 */
async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.text();
      lastError = new Error(
        "HTTP " + response.status + (response.statusText ? " " + response.statusText : ""),
      );
      // 4xx 是配置/权限问题，重试没有意义
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
  }
  const reason =
    lastError instanceof Error
      ? lastError.message + (lastError.cause instanceof Error ? "（" + lastError.cause.message + "）" : "")
      : String(lastError);
  throw new Error("拉取 " + url + " 失败（已尝试 " + MAX_ATTEMPTS + " 次）: " + reason);
}

async function fetchJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("解析 " + url + " 的 JSON 失败: " + error.message);
  }
}

/**
 * AA 前端把模型数组塞进 Next.js 的 RSC flight 流（self.__next_f.push），
 * 这里把分片拼回字符串后，从 "initialModels" 处按括号配对截出数组。
 */
function extractInitialModels(html, label) {
  const chunks = [];
  const pushPattern = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (let match = pushPattern.exec(html); match; match = pushPattern.exec(html)) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      // 非 JSON 字符串分片，跳过
    }
  }
  const stream = chunks.join("");
  const marker = stream.indexOf('"initialModels":');
  if (marker < 0) {
    throw new Error(label + " 页面里找不到 initialModels（AA 前端结构可能已变化）");
  }
  const start = stream.indexOf("[", marker);
  let depth = 0;
  let end = -1;
  for (let index = start; index < stream.length; index += 1) {
    const char = stream[index];
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) throw new Error(label + " 页面里的 initialModels 数组括号不闭合");
  let models;
  try {
    models = JSON.parse(stream.slice(start, end + 1));
  } catch (error) {
    throw new Error(label + " 页面里的 initialModels 解析失败: " + error.message);
  }
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(label + " 页面解析出的 initialModels 为空");
  }
  return models;
}

/** 单条评测的美元成本：token 消耗量 × 官方价格（缓存读写按 AA 的口径折算） */
function evalCostUSD(tokens, model) {
  if (!tokens) return null;
  const inputPrice = model.price1mInputTokens;
  const outputPrice = model.price1mOutputTokens;
  if (inputPrice == null || outputPrice == null) return null;
  const cacheHitPrice = model.cacheHitPrice ?? inputPrice * 0.25;
  const cacheWritePrice = model.cacheWritePrice ?? inputPrice;
  const cacheHitRate = model.cacheHitRate ?? 0;
  const cacheable = tokens.cacheableInput ?? 0;
  const nonCacheInput = Math.max(0, tokens.input - cacheable);
  const usd =
    nonCacheInput * inputPrice +
    cacheable * cacheHitRate * cacheHitPrice +
    cacheable * (1 - cacheHitRate) * cacheWritePrice +
    ((tokens.answer ?? 0) + (tokens.reasoning ?? 0)) * outputPrice;
  return usd / 1e6;
}

/** 每支支柱的"每任务成本"：支柱内评测的每任务成本的权重加权平均 */
function computePillarCosts(model) {
  const out = {};
  for (const pillar of PILLARS) {
    const evals = Object.values(EVALS).filter((evaluation) => evaluation.pillar === pillar);
    let numerator = 0;
    let denominator = 0;
    for (const evaluation of evals) {
      const tokens = model.canonicalEvalTokenCounts?.[evaluation.tokens];
      const costPerEval = evalCostUSD(tokens, model);
      if (costPerEval == null) continue;
      numerator += (costPerEval / evaluation.tasks) * evaluation.weight;
      denominator += evaluation.weight;
    }
    out[pillar] = denominator > 0 ? numerator / denominator : null;
  }
  return out;
}

function round(value, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** 上游目录的结构自检，缺字段就立刻报错，别把半截数据写进仓库 */
function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error("模型目录响应不是 JSON 对象");
  }
  if (!Array.isArray(catalog.models) || catalog.models.length === 0) {
    throw new Error("模型目录响应缺少非空的 models 数组");
  }
  if (typeof catalog.syncedAt !== "string") {
    throw new Error("模型目录响应缺少 syncedAt");
  }
  if (!isFiniteNumber(catalog.refreshIntervalMs)) {
    throw new Error("模型目录响应缺少 refreshIntervalMs");
  }
  if (!catalog.source || typeof catalog.source !== "object") {
    throw new Error("模型目录响应缺少 source");
  }
  for (const model of catalog.models) {
    if (typeof model.slug !== "string" || model.slug === "") {
      throw new Error("模型目录里存在没有 slug 的模型: " + JSON.stringify(model).slice(0, 120));
    }
  }
}

/** 把 AA 两个页面的数据合成每个模型的 dimensions */
function buildDimensions(intelligenceModels, engineeringModels, catalogBySlug) {
  const engineeringById = new Map(engineeringModels.map((model) => [model.id, model]));
  const dimensionsBySlug = new Map();
  const problems = [];
  const warnings = [];
  let incompleteTokenCount = 0;

  for (const model of intelligenceModels) {
    const engineering = engineeringById.get(model.id);
    if (!engineering) {
      problems.push(model.slug + ": Engineering 页缺少同 id 的记录");
      continue;
    }
    if (!catalogBySlug.has(model.slug)) {
      problems.push(model.slug + ": 模型目录里没有这个 slug");
      continue;
    }

    const subScores = engineering.subScores ?? {};
    const pillars = {};
    let pillarsComplete = true;
    for (const pillar of PILLARS) {
      const field = SUB_SCORE_FIELDS[pillar];
      const value = subScores[field];
      if (!isFiniteNumber(value) || value < 0 || value > 100) {
        problems.push(model.slug + ": subScores." + field + " 不是 0-100 的数字");
        pillarsComplete = false;
        break;
      }
      pillars[pillar] = round(value, 2);
    }

    // 缺任何一项评测的 token 消耗都会让成本口径偏窄，先记下来
    if (
      Object.values(EVALS).some(
        (evaluation) => !model.canonicalEvalTokenCounts?.[evaluation.tokens],
      )
    ) {
      incompleteTokenCount += 1;
    }

    // 支柱成本必须全部可算且为正；免费模型（价格为 0）或不公布价格的模型给 null
    const rawCosts = computePillarCosts(model);
    const costsPositive = PILLARS.every(
      (pillar) => isFiniteNumber(rawCosts[pillar]) && rawCosts[pillar] > 0,
    );
    const pillarCosts = costsPositive
      ? Object.fromEntries(PILLARS.map((pillar) => [pillar, round(rawCosts[pillar], 4)]))
      : null;

    // 交叉校验：用支柱分数反算 AA 官方 Engineering Index，验证 subScores 字段映射没变
    if (pillarsComplete && isFiniteNumber(engineering.weightedIndex)) {
      const recomputed = PILLARS.reduce(
        (sum, pillar) => sum + ENGINEERING_WEIGHTS[pillar] * pillars[pillar],
        0,
      );
      if (Math.abs(recomputed - engineering.weightedIndex) > 0.02) {
        warnings.push(
          model.slug + ": 支柱加权与 AA Engineering Index 不一致（误差 " +
            Math.abs(recomputed - engineering.weightedIndex).toFixed(4) + "）",
        );
      }
    }

    dimensionsBySlug.set(model.slug, {
      pillars: pillarsComplete ? pillars : null,
      pillarCosts,
      openWeights: typeof model.isOpenWeights === "boolean" ? model.isOpenWeights : null,
    });
  }

  if (incompleteTokenCount > 0) {
    warnings.push(
      incompleteTokenCount + " 个模型缺少部分评测的 token 消耗，支柱成本按剩余评测加权",
    );
  }

  return { dimensionsBySlug, problems, warnings };
}

/** 复算的每任务总成本 = Σ 支柱权重 × 该支柱每任务成本（权重 = 支柱内评测权重之和） */
function recomputeTotalCost(pillarCosts) {
  const pillarWeights = Object.fromEntries(
    PILLARS.map((pillar) => [
      pillar,
      Object.values(EVALS)
        .filter((evaluation) => evaluation.pillar === pillar)
        .reduce((sum, evaluation) => sum + evaluation.weight, 0),
    ]),
  );
  let total = 0;
  for (const pillar of PILLARS) {
    total += pillarWeights[pillar] * pillarCosts[pillar];
  }
  return total;
}

/** 评测权重必须合 1，否则支柱内成本加权口径就不再是"按 Intelligence Index 权重" */
function assertEvalWeights() {
  const sum = Object.values(EVALS).reduce((total, evaluation) => total + evaluation.weight, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error("9 项评测的权重合计 " + sum + "，应为 1");
  }
}

async function main() {
  assertEvalWeights();
  log("抓取数据源 ...");
  const [catalog, intelligenceHtml, engineeringHtml] = await Promise.all([
    fetchJson(SOURCES.catalog),
    fetchText(SOURCES.intelligence),
    fetchText(SOURCES.engineering),
  ]);
  validateCatalog(catalog);

  const intelligenceModels = extractInitialModels(intelligenceHtml, "Intelligence Index");
  const engineeringModels = extractInitialModels(engineeringHtml, "Engineering Index");
  const catalogBySlug = new Map(catalog.models.map((model) => [model.slug, model]));
  const creators = new Set(catalog.models.map((model) => model.creator));

  log(
    "模型目录 " + catalog.models.length + " 个模型 / " + creators.size + " 个厂商, syncedAt=" +
      catalog.syncedAt + ", indexVersion=" + catalog.indexVersion,
  );
  log(
    "AA 完整评测: Intelligence 页 " + intelligenceModels.length + " 个模型, Engineering 页 " +
      engineeringModels.length + " 个模型",
  );
  if (intelligenceModels.length < 20) {
    throw new Error(
      "AA 完整评测的模型只有 " + intelligenceModels.length + " 个，疑似上游页面异常，放弃写入",
    );
  }

  const { dimensionsBySlug, problems, warnings } = buildDimensions(
    intelligenceModels,
    engineeringModels,
    catalogBySlug,
  );
  if (problems.length > 0) {
    throw new Error("数据合并有问题:\n  - " + problems.join("\n  - "));
  }
  for (const warning of warnings) log("警告: " + warning);

  // 只给有 AA 数据的模型加 dimensions，其余上游字段原样保留、顺序不变
  let merged = 0;
  const models = catalog.models.map((model) => {
    const dimensions = dimensionsBySlug.get(model.slug);
    if (!dimensions) return model;
    merged += 1;
    return { ...model, dimensions };
  });
  if (merged !== dimensionsBySlug.size) {
    throw new Error(
      "dimensions 只合并进 " + merged + " 个模型，预期 " + dimensionsBySlug.size + " 个",
    );
  }

  const nextCatalog = { ...catalog, models };
  const serialized = JSON.stringify(nextCatalog, null, 2) + "\n";

  const withPillars = models.filter((model) => model.dimensions?.pillars).length;
  const withCosts = models.filter((model) => model.dimensions?.pillarCosts).length;
  const openWeights = models.filter((model) => model.dimensions?.openWeights === true).length;
  const comparable = models.filter(
    (model) =>
      isFiniteNumber(model.intelligence) && isFiniteNumber(model.costPerTask) && model.costPerTask > 0,
  ).length;

  // 官方口径交叉校验：支柱成本反算总成本 vs 目录里的 costPerTask
  let worstDeviation = 0;
  let worstSlug = null;
  let compared = 0;
  for (const model of models) {
    const costs = model.dimensions?.pillarCosts;
    if (!costs || !isFiniteNumber(model.costPerTask) || model.costPerTask <= 0) continue;
    const deviation = Math.abs(recomputeTotalCost(costs) - model.costPerTask) / model.costPerTask;
    compared += 1;
    if (deviation > worstDeviation) {
      worstDeviation = deviation;
      worstSlug = model.slug;
    }
  }
  log(
    "复算校验: " + compared + " 个模型的每任务总成本最大相对偏差 " +
      (worstDeviation * 100).toFixed(2) + "%" + (worstSlug ? "（" + worstSlug + "）" : ""),
  );
  if (worstDeviation > COST_TOLERANCE) {
    log(
      "警告: 复算成本与 AA 官方 costPerTask 偏差超过 " + COST_TOLERANCE * 100 +
        "%，请检查评测权重/价格口径",
    );
  }

  log(
    "dimensions: " + merged + " 个模型（pillars " + withPillars + " / pillarCosts " + withCosts +
      " / 开源权重 " + openWeights + "），综合视角可比较 " + comparable + " 个模型",
  );

  let previous = null;
  try {
    previous = await readFile(OUTPUT_PATH, "utf8");
  } catch {
    // 首次生成
  }
  if (previous === serialized) {
    log("catalog.json 内容未变化，跳过写入");
    return;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, serialized, "utf8");
  log(
    "写入 " + OUTPUT_PATH + "（" + (Buffer.byteLength(serialized) / 1024).toFixed(1) + " KB）",
  );
}

main().catch((error) => {
  console.error("[build-data] 失败: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});