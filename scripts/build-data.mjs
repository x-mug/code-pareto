#!/usr/bin/env node
// 从基础目录和 AA 附加评测生成快照，数据偏差仅告警。
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelUpdates, persistSnapshotFiles } from "./model-updates.mjs";
import { extractAaIndexMajor, extractAaModelDetails, extractAaReleaseModels, mergeAaCatalog } from "./aa-catalog-merge.mjs";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const SOURCES = {
  catalog: "https://parallax.zzz.sd/api/models",
  intelligence:
    "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index",
  engineering: "https://artificialanalysis.ai/indexes/engineering",
  leaderboard: "https://artificialanalysis.ai/leaderboards/models",
  releases: "https://artificialanalysis.ai/models/releases",
};

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/data/catalog.json", import.meta.url),
);
const UPDATES_PATH = fileURLToPath(
  new URL("../src/data/recent-model-updates.json", import.meta.url),
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
// 跨快照成本偏差超过此值时告警。
const COST_WARNING_THRESHOLD = 0.1;

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
  if (!Array.isArray(models)) {
    throw new Error(label + " 页面解析出的 initialModels 不是数组");
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
  if (!Array.isArray(catalog.models)) {
    throw new Error("模型目录响应缺少 models 数组");
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
export function buildDimensions(intelligenceModels, engineeringModels, catalogBySlug) {
  const engineeringById = new Map();
  const engineeringBySlug = new Map();
  for (const model of engineeringModels) {
    if (!model || typeof model.id !== "string" || !model.id || typeof model.slug !== "string" || !model.slug) {
      throw new Error("Engineering 页包含缺少 id 或 slug 的模型");
    }
    if (engineeringById.has(model.id) || engineeringBySlug.has(model.slug)) {
      throw new Error("Engineering 页包含重复身份: " + model.slug);
    }
    engineeringById.set(model.id, model);
    engineeringBySlug.set(model.slug, model);
  }
  const catalogByAaId = new Map();
  for (const model of catalogBySlug.values()) {
    const aaId = model.catalogIdentity?.aaId ?? model.id;
    if (!aaId) continue;
    if (catalogByAaId.has(aaId) && catalogByAaId.get(aaId) !== model) {
      throw new Error("模型目录包含重复的 AA 身份: " + aaId);
    }
    catalogByAaId.set(aaId, model);
  }
  const dimensionsBySlug = new Map();
  const problems = [];
  const warnings = [];
  let incompleteTokenCount = 0;

  for (const model of intelligenceModels) {
    const engineering = engineeringById.get(model.id);
    const engineeringSlugMatch = engineeringBySlug.get(model.slug);
    if (engineeringSlugMatch && engineeringSlugMatch.id !== model.id) {
      throw new Error(model.slug + ": Engineering 页的 id 或 slug 冲突");
    }
    if (!engineering) {
      warnings.push(model.slug + ": Engineering 页缺少同 id 的记录，保留基础数据");
      continue;
    }
    const intelligenceCreator = model.creator ?? {};
    const engineeringCreator = engineering.creator ?? {};
    if (intelligenceCreator.id && engineeringCreator.id) {
      if (intelligenceCreator.id !== engineeringCreator.id) throw new Error(model.slug + ": Engineering 页的厂商 id 冲突");
    } else if (intelligenceCreator.name && engineeringCreator.name) {
      if (intelligenceCreator.name !== engineeringCreator.name) throw new Error(model.slug + ": Engineering 页的厂商名称冲突");
    } else if (engineering.slug !== model.slug) {
      throw new Error(model.slug + ": Engineering 页的改名缺少可核实的厂商信息");
    }
    const catalogSlugMatch = catalogBySlug.get(model.slug);
    const catalogIdMatch = catalogByAaId.get(model.id);
    if (catalogSlugMatch && catalogIdMatch && catalogSlugMatch !== catalogIdMatch) {
      throw new Error(model.slug + ": 模型目录的 id 与 slug 冲突");
    }
    const catalogModel = catalogSlugMatch ?? catalogIdMatch;
    if (!catalogModel) {
      warnings.push(model.slug + ": 模型目录里没有对应模型，跳过");
      continue;
    }
    const catalogAaId = catalogModel.catalogIdentity?.aaId ?? catalogModel.id;
    if (catalogAaId !== model.id) throw new Error(model.slug + ": 模型目录的 AA id 冲突");
    const catalogCreatorId = catalogModel.creatorId ?? catalogModel.creator?.id;
    const catalogCreatorName = typeof catalogModel.creator === "string" ? catalogModel.creator : catalogModel.creator?.name;
    const hasMatchingCreatorIds = Boolean(intelligenceCreator.id && catalogCreatorId &&
      intelligenceCreator.id === catalogCreatorId);
    const hasMatchingCreatorNames = Boolean(intelligenceCreator.name && catalogCreatorName &&
      intelligenceCreator.name === catalogCreatorName);
    if (intelligenceCreator.id && catalogCreatorId) {
      if (!hasMatchingCreatorIds) throw new Error(model.slug + ": 模型目录的厂商 id 冲突");
    } else if (intelligenceCreator.name && catalogCreatorName) {
      if (!hasMatchingCreatorNames) throw new Error(model.slug + ": 模型目录的厂商名称冲突");
    } else if (catalogModel.slug !== model.slug) {
      throw new Error(model.slug + ": 模型目录的改名缺少可核实的厂商信息");
    }
    if (catalogModel.slug !== model.slug && catalogModel.catalogIdentity?.aaId !== model.id && !hasMatchingCreatorIds) {
      throw new Error(model.slug + ": 模型目录的改名缺少已验证身份");
    }

    const subScores = engineering.subScores ?? {};
    const pillars = {};
    let pillarsComplete = true;
    for (const pillar of PILLARS) {
      const field = SUB_SCORE_FIELDS[pillar];
      const value = subScores[field];
      if (value === null || value === undefined) {
        warnings.push(model.slug + ": subScores." + field + " 缺失，保留基础数据");
        pillarsComplete = false;
        break;
      }
      if (!isFiniteNumber(value)) {
        warnings.push(model.slug + ": subScores." + field + " 不是数字，保留基础数据");
        pillarsComplete = false;
        break;
      }
      if (value < 0 || value > 100) {
        warnings.push(model.slug + ": subScores." + field + " 超出历史范围，保留上游数值 " + value);
      }
      pillars[pillar] = round(value, 2);
    }
    if (!pillarsComplete) continue;
    if (typeof model.isOpenWeights !== "boolean") {
      warnings.push(model.slug + ": 开源权重信息缺失，保留基础数据");
      continue;
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
    const roundedCosts = costsPositive
      ? Object.fromEntries(PILLARS.map((pillar) => [pillar, round(rawCosts[pillar], 4)]))
      : null;
    const pillarCosts = roundedCosts && PILLARS.every((pillar) => roundedCosts[pillar] > 0) ? roundedCosts : null;

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

    dimensionsBySlug.set(catalogModel.slug, {
      pillars,
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

export function applyDimensions(models, dimensionsBySlug) {
  let merged = 0;
  function completeDimensions(model) {
    const dimensions = model.dimensions;
    const pillars = dimensions?.pillars;
    const costs = dimensions?.pillarCosts;
    if (!isFiniteNumber(model.intelligence) || !pillars || typeof dimensions.openWeights !== "boolean") return false;
    if (Object.keys(pillars).length !== PILLARS.length ||
        !PILLARS.every((pillar) => isFiniteNumber(pillars[pillar]))) return false;
    return costs === null || (costs && Object.keys(costs).length === PILLARS.length &&
      PILLARS.every((pillar) => isFiniteNumber(costs[pillar]) && costs[pillar] > 0));
  }
  const result = models.map((model) => {
    if (model.aaStale === true) return completeDimensions(model) ? model : withoutDimensions(model);
    const dimensions = dimensionsBySlug.get(model.slug);
    if (isFiniteNumber(model.intelligence) && dimensions) {
      merged += 1;
      return { ...model, dimensions };
    }
    return withoutDimensions(model);
  });
  return { models: result, merged };
}

function withoutDimensions(model) {
  if (model.dimensions === undefined) return model;
  const rest = { ...model };
  delete rest.dimensions;
  return rest;
}

async function main() {
  assertEvalWeights();
  async function readIfPresent(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  const [previous, previousUpdatesText] = await Promise.all([
    readIfPresent(OUTPUT_PATH),
    readIfPresent(UPDATES_PATH),
  ]);
  const previousCatalog = previous === null ? null : JSON.parse(previous);
  const previousUpdates = previousUpdatesText === null ? { events: [] } : JSON.parse(previousUpdatesText);
  log("抓取数据源 ...");
  const optionalPage = async (url, label) => {
    try {
      return await fetchText(url);
    } catch (error) {
      log("警告: " + label + " 获取失败：" + error.message);
      return null;
    }
  };
  const [catalog, intelligenceHtml, engineeringHtml, leaderboardHtml, releasesHtml] = await Promise.all([
    fetchJson(SOURCES.catalog),
    optionalPage(SOURCES.intelligence, "AA Intelligence Index"),
    optionalPage(SOURCES.engineering, "AA Engineering Index"),
    optionalPage(SOURCES.leaderboard, "AA 排行榜"),
    optionalPage(SOURCES.releases, "AA 发布列表"),
  ]);
  validateCatalog(catalog);

  function optionalModels(html, label) {
    if (html === null) return [];
    try {
      return extractInitialModels(html, label);
    } catch (error) {
      log("警告: " + label + " 解析失败：" + error.message);
      return [];
    }
  }
  const intelligenceModels = optionalModels(intelligenceHtml, "Intelligence Index");
  const engineeringModels = optionalModels(engineeringHtml, "Engineering Index");
  if (engineeringModels.length === 0) log("警告: Engineering Index 没有模型，继续更新基础目录");
  const leaderboardModels = optionalModels(leaderboardHtml, "AA 排行榜");
  let releaseModels = [];
  if (releasesHtml !== null) {
    try {
      releaseModels = extractAaReleaseModels(releasesHtml);
    } catch (error) {
      log("警告: AA 发布列表解析失败：" + error.message);
    }
  }
  const supplemented = await mergeAaCatalog({
    catalogModels: catalog.models,
    previousModels: previousCatalog?.models ?? [],
    intelligenceModels,
    releaseModels,
    leaderboardModels,
    indexVersion: catalog.indexVersion,
    aaIndexMajor: extractAaIndexMajor(intelligenceHtml),
    fetchDetail: async (slug) => {
      const html = await fetchText("https://artificialanalysis.ai/models/" + encodeURIComponent(slug));
      return extractAaModelDetails(html, slug);
    },
  });
  for (const warning of supplemented.warnings) log("警告: " + warning);
  const catalogBySlug = new Map(supplemented.models.map((model) => [model.slug, model]));
  const creators = new Set(supplemented.models.map((model) => model.creator));

  log(
    "模型目录 " + catalog.models.length + " 个模型 / " + creators.size + " 个厂商, syncedAt=" +
      catalog.syncedAt + ", indexVersion=" + catalog.indexVersion,
  );
  log(
    "AA 完整评测: Intelligence 页 " + intelligenceModels.length + " 个模型, Engineering 页 " +
      engineeringModels.length + " 个模型",
  );

  const { dimensionsBySlug, problems, warnings } = buildDimensions(
    [...intelligenceModels, ...supplemented.supplementalCandidates],
    engineeringModels,
    catalogBySlug,
  );
  for (const warning of [...problems, ...warnings]) log("警告: " + warning);

  // 只给有 AA 数据的模型加 dimensions，其余上游字段原样保留、顺序不变
  const { models, merged } = applyDimensions(supplemented.models, dimensionsBySlug);

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
  if (worstDeviation > COST_WARNING_THRESHOLD) {
    log(
      "警告: 复算成本与 AA 官方 costPerTask 偏差超过 " + COST_WARNING_THRESHOLD * 100 +
        "%，请检查评测权重/价格口径",
    );
  }

  log(
    "dimensions: " + merged + " 个模型（pillars " + withPillars + " / pillarCosts " + withCosts +
      " / 开源权重 " + openWeights + "），综合视角可比较 " + comparable + " 个模型",
  );

  const nextUpdates = buildModelUpdates(previousCatalog, nextCatalog, previousUpdates, new Date().toISOString());
  const updatesSerialized = nextUpdates === previousUpdates && previousUpdatesText !== null
    ? previousUpdatesText
    : JSON.stringify(nextUpdates, null, 2) + "\n";
  const files = [];
  if (previousUpdatesText !== updatesSerialized) {
    files.push({ path: UPDATES_PATH, previous: previousUpdatesText, content: updatesSerialized });
  }
  if (previous !== serialized) {
    files.push({ path: OUTPUT_PATH, previous, content: serialized });
  }
  if (files.length === 0) {
    log("目录和变更记录均未变化，跳过写入");
    return;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await persistSnapshotFiles(files);
  for (const file of files) {
    log("写入 " + file.path + "（" + (Buffer.byteLength(file.content) / 1024).toFixed(1) + " KB）");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[build-data] 失败: " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}