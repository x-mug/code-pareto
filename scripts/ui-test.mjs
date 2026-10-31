// 静态导出产物功能门禁：本地静态服务 + jsdom 加载 out/，真实点击视角/滑杆/表头。
// 期望值一律从 src/data/catalog.json 推导，catalog 每 8 小时由 CI 重建也不会打断断言。
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "out");
const CATALOG_FILE = path.join(ROOT, "src/data/catalog.json");
const PREFIX = "/code-pareto";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".png": "image/png",
};

// —— 以下常量与函数复刻 src/lib/models.ts 与 src/lib/view-logic.ts 的最简版本 ——
const PILLARS = ["coding", "akw", "science", "reasoning", "knowledge"];
const VIEW_PRESETS = {
  coding: { coding: 1 },
  codingEngineering: { coding: 0.6, akw: 0.4 },
  aaEngineering: { knowledge: 0.3, science: 0.2, reasoning: 0.2, coding: 0.15, akw: 0.15 },
};
const DEFAULT_CUSTOM_WEIGHTS = { coding: 0.6, akw: 0.4, science: 0, reasoning: 0, knowledge: 0 };
// 把 coding 滑杆从 60% 拖到 90% 时，其余支柱按原比例分走剩下的 10%
const DRAG_WEIGHTS = { coding: 0.9, akw: 0.1, science: 0, reasoning: 0, knowledge: 0 };

// 界面默认语言是 zh-CN，文案与 src/lib/i18n.ts 的 zh-CN 块一致
const VIEW_LABELS = [
  "综合智能",
  "纯编程",
  "编程 + 工程",
  "AA 工程指数",
  "自定义",
];
const OPEN_WEIGHTS_LABEL = "仅开源权重";
// 对照轴页签文案，与 src/lib/i18n.ts 的 zh-CN 块一致
const AXIS_LABELS = { cost: "能力 / 价格", speed: "能力 / 速度" };

function normalizeWeights(input) {
  const out = {};
  let sum = 0;
  for (const pillar of PILLARS) {
    const value = Number(input[pillar]);
    out[pillar] = Number.isFinite(value) && value > 0 ? value : 0;
    sum += out[pillar];
  }
  if (sum <= 0) return { ...DEFAULT_CUSTOM_WEIGHTS };
  for (const pillar of PILLARS) out[pillar] /= sum;
  return out;
}

function weightsForView(view, customWeights) {
  if (view === "intelligence") return null;
  if (view === "custom") return normalizeWeights(customWeights);
  return normalizeWeights(VIEW_PRESETS[view]);
}

function applyView(models, view, customWeights) {
  if (view === "intelligence") return models;
  const weights = weightsForView(view, customWeights);
  if (!weights) return models;

  return models.map((model) => {
    const dimensions = model.dimensions;
    if (!dimensions || !dimensions.pillars || !dimensions.pillarCosts) {
      return { ...model, intelligence: null, costPerTask: null };
    }
    let score = 0;
    let cost = 0;
    for (const pillar of PILLARS) {
      const weight = weights[pillar];
      if (weight <= 0) continue;
      const pillarScore = dimensions.pillars[pillar];
      const pillarCost = dimensions.pillarCosts[pillar];
      if (
        typeof pillarScore !== "number" ||
        typeof pillarCost !== "number" ||
        !Number.isFinite(pillarScore) ||
        !Number.isFinite(pillarCost)
      ) {
        return { ...model, intelligence: null, costPerTask: null };
      }
      score += weight * pillarScore;
      cost += weight * pillarCost;
    }
    return { ...model, intelligence: score, costPerTask: cost };
  });
}

function isChartable(model) {
  return (
    typeof model.intelligence === "number" &&
    Number.isFinite(model.intelligence) &&
    typeof model.costPerTask === "number" &&
    Number.isFinite(model.costPerTask) &&
    model.costPerTask > 0
  );
}

function countRows(models, view, weights) {
  return applyView(models, view, weights).filter(isChartable).length;
}

function openOnlyRows(models, view, weights) {
  const openModels = models.filter((model) => model.dimensions?.openWeights === true);
  return countRows(openModels, view, weights);
}

// —— 断言与等待 ——
let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log("  PASS " + name);
  } else {
    failed += 1;
    console.log("  FAIL " + name + (detail ? " :: " + detail : ""));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let hit = false;
    try {
      hit = Boolean(predicate());
    } catch {
      hit = false;
    }
    if (hit) return true;
    await sleep(100);
  }
  try {
    return Boolean(predicate());
  } catch {
    return false;
  }
}

// —— 前置检查：产物与数据必须存在 ——
if (!existsSync(path.join(OUT_DIR, "index.html"))) {
  console.log("缺少 out/index.html，请先运行 npm run build 生成静态导出产物。");
  process.exit(1);
}
if (!existsSync(CATALOG_FILE)) {
  console.log("缺少 src/data/catalog.json，请先运行 npm run data:build。");
  process.exit(1);
}

let catalog;
try {
  catalog = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
} catch (error) {
  console.log("src/data/catalog.json 解析失败: " + error.message);
  process.exit(1);
}

const models = Array.isArray(catalog.models) ? catalog.models : [];
if (models.length === 0) {
  console.log("catalog.json 里没有模型，无法推导期望值。");
  process.exit(1);
}

// —— 速度轴：复刻 src/lib/speed-logic.ts 的最简版本 ——
// 能力有限且输出速度有限为正的模型才能上速度图
function hasOutputSpeed(model) {
  return (
    typeof model.intelligence === "number" &&
    Number.isFinite(model.intelligence) &&
    typeof model.outputSpeed === "number" &&
    Number.isFinite(model.outputSpeed) &&
    model.outputSpeed > 0
  );
}

// 速度前沿：按输出速度降序，只留分数持续抬升的点
function speedFrontierOf(list) {
  const sorted = list
    .filter(hasOutputSpeed)
    .sort((a, b) => b.outputSpeed - a.outputSpeed || b.intelligence - a.intelligence);
  let bestScore = Number.NEGATIVE_INFINITY;
  return sorted.filter((model) => {
    if (model.intelligence <= bestScore) return false;
    bestScore = model.intelligence;
    return true;
  });
}

// 速度膝点：归一化后按 kneeScore 排序，退化区间按 0 处理
function speedKneeIds(list, limit) {
  const frontier = speedFrontierOf(list);
  if (frontier.length === 0) return [];
  if (frontier.length === 1) return [frontier[0].id];

  const fastest = frontier[0];
  const slowest = frontier[frontier.length - 1];
  const logFastestSpeed = Math.log10(fastest.outputSpeed);
  const logSpeedRange = logFastestSpeed - Math.log10(slowest.outputSpeed);
  const scoreRange = slowest.intelligence - fastest.intelligence;
  const safeRatio = (numerator, denominator) => {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
    if (Math.abs(denominator) < 1e-12) return 0;
    const value = numerator / denominator;
    return Number.isFinite(value) ? value : 0;
  };

  return frontier
    .map((model) => {
      const normalizedSpeed = safeRatio(logFastestSpeed - Math.log10(model.outputSpeed), logSpeedRange);
      const normalizedScore = safeRatio(model.intelligence - fastest.intelligence, scoreRange);
      return {
        model,
        kneeScore: normalizedScore - normalizedSpeed,
        idealDistance: Math.hypot(normalizedSpeed, 1 - normalizedScore),
      };
    })
    .sort((a, b) => {
      const kneeDelta = b.kneeScore - a.kneeScore;
      if (Math.abs(kneeDelta) > 1e-12) return kneeDelta;
      const idealDelta = a.idealDistance - b.idealDistance;
      if (Math.abs(idealDelta) > 1e-12) return idealDelta;
      return b.model.outputSpeed - a.model.outputSpeed;
    })
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((entry) => entry.model.id);
}

const chartableAll = applyView(models, "intelligence", DEFAULT_CUSTOM_WEIGHTS).filter(isChartable);
const expected = {
  total: models.length,
  intelligence: countRows(models, "intelligence", DEFAULT_CUSTOM_WEIGHTS),
  coding: countRows(models, "coding", DEFAULT_CUSTOM_WEIGHTS),
  codingEngineering: countRows(models, "codingEngineering", DEFAULT_CUSTOM_WEIGHTS),
  custom: countRows(models, "custom", DEFAULT_CUSTOM_WEIGHTS),
  customDrag: countRows(models, "custom", DRAG_WEIGHTS),
  openCustomDrag: openOnlyRows(models, "custom", DRAG_WEIGHTS),
  openIntelligence: openOnlyRows(models, "intelligence", DEFAULT_CUSTOM_WEIGHTS),
  creators: new Set(chartableAll.map((model) => model.creator)).size,
  defaultShares: PILLARS.map(
    (pillar) => Math.round(normalizeWeights(DEFAULT_CUSTOM_WEIGHTS)[pillar] * 100) + "%",
  ),
  dragShares: PILLARS.map(
    (pillar) => Math.round(normalizeWeights(DRAG_WEIGHTS)[pillar] * 100) + "%",
  ),
};
// 链接里 w=coding:100 归一化后编程独占 100%，其余支柱为 0
const codingOnlyShares = PILLARS.map(
  (pillar) =>
    Math.round(
      normalizeWeights({ coding: 100, akw: 0, science: 0, reasoning: 0, knowledge: 0 })[pillar] * 100,
    ) + "%",
);
// 拖拽目标必须同时具备「编程/工程得分差」与「编程/工程成本差」，否则拖拽后指标看不出变化
const dragTarget = models.find((model) => {
  const dimensions = model.dimensions;
  if (!dimensions || !dimensions.pillars || !dimensions.pillarCosts) return false;
  const scoreGap = Math.abs(dimensions.pillars.coding - dimensions.pillars.akw);
  const costGap = Math.abs(
    dimensions.pillarCosts.coding - dimensions.pillarCosts.akw,
  );
  const costRatio =
    costGap / Math.max(Math.abs(dimensions.pillarCosts.coding), Math.abs(dimensions.pillarCosts.akw), 1e-9);
  return scoreGap > 1 && costRatio > 0.02;
});
const dragTargetAfterMath = dragTarget
  ? applyView([dragTarget], "custom", DRAG_WEIGHTS).filter(isChartable)[0] ?? null
  : null;

// 速度轴期望：可上图数、顶部膝点推荐数、这些膝点里有多少能落进价格轴表格
const speedKneeTopIds = speedKneeIds(models, 5);
const costChartableIds = new Set(chartableAll.map((model) => model.id));
const speedExpected = {
  rows: models.filter(hasOutputSpeed).length,
  recommendations: speedKneeTopIds.length,
  kneeTableRows: speedKneeTopIds.slice(0, 2).filter((id) => costChartableIds.has(id)).length,
};

console.log("catalog: " + expected.total + " 个模型（syncedAt " + catalog.syncedAt + "）");
console.log(
  "推导期望: 综合 " +
    expected.intelligence +
    " / 纯编程 " +
    expected.coding +
    " / 自定义 " +
    expected.custom +
    " / 自定义拖拽 " +
    expected.customDrag +
    " / 仅开源(综合) " +
    expected.openIntelligence +
    " / 仅开源(拖拽权重) " +
    expected.openCustomDrag +
    " / 厂商 " +
    expected.creators,
);
console.log(
  "速度轴推导: 可上图 " +
    speedExpected.rows +
    "（价格轴 " +
    expected.intelligence +
    "） / 膝点推荐 " +
    speedExpected.recommendations +
    " / 表格膝点行 " +
    speedExpected.kneeTableRows,
);
if (!dragTarget) {
  console.log("警告: catalog 里找不到编程与工程指标差异明显的模型，拖拽数值推导会被跳过。");
}

// —— 本地静态服务，把 out/ 挂在 /code-pareto 下 ——
const server = http.createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith(PREFIX)) url = url.slice(PREFIX.length);
  if (url === "" || url.endsWith("/")) url += "index.html";
  const filePath = path.join(OUT_DIR, url);
  if (filePath !== OUT_DIR && !filePath.startsWith(OUT_DIR + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = "http://127.0.0.1:" + server.address().port + PREFIX + "/";

let jsdomImport;
try {
  jsdomImport = await import("jsdom");
} catch (error) {
  console.log("缺少 jsdom 依赖（应在 devDependencies 里）：npm install -D jsdom");
  console.log(String(error && error.message));
  server.close();
  process.exit(1);
}
const { JSDOM, VirtualConsole } = jsdomImport;

const errors = [];
const warnings = [];
// URL 场景各自独立加载页面，统一登记以便收尾关闭
const extraPages = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => {
  errors.push("jsdomError: " + String(error && error.message).slice(0, 240));
});
virtualConsole.on("error", (...args) => {
  errors.push("console.error: " + String(args[0]).slice(0, 240));
});
virtualConsole.on("warn", (...args) => {
  warnings.push("console.warn: " + String(args[0]).slice(0, 240));
});

// jsdom 不跑布局也不实现 canvas，这里补最小可用的替身，让首屏代码能真实水合
function installEnvironmentShims(window) {
  const nodeGlobals = [
    "ReadableStream",
    "WritableStream",
    "TransformStream",
    "TextEncoder",
    "TextDecoder",
    "MessageChannel",
    "MessagePort",
    "AbortController",
    "AbortSignal",
    "Blob",
    "File",
    "FormData",
    "Headers",
    "Request",
    "Response",
    "fetch",
    "structuredClone",
    "queueMicrotask",
    "setImmediate",
    "crypto",
  ];
  for (const key of nodeGlobals) {
    if (!(key in window) && key in globalThis) window[key] = globalThis[key];
  }

  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.devicePixelRatio = 1;
  // jsdom 没有 matchMedia，而主题与移动断点都依赖它
  window.matchMedia = (query) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  });

  const gradient = () => ({ addColorStop() {} });
  const contextBase = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    arc() {},
    arcTo() {},
    rect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    fillText() {},
    strokeText() {},
    translate() {},
    scale() {},
    rotate() {},
    transform() {},
    setTransform() {},
    resetTransform() {},
    setLineDash() {},
    getLineDash() {
      return [];
    },
    measureText(text) {
      return {
        width: String(text ?? "").length * 7,
        actualBoundingBoxAscent: 8,
        actualBoundingBoxDescent: 2,
      };
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => ({}),
    getImageData: (x, y, width, height) => ({
      data: new Uint8ClampedArray(Math.max(1, (width | 0) * (height | 0) * 4)),
    }),
    putImageData() {},
    drawImage() {},
    isPointInPath: () => false,
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type !== "2d") return null;
    const context = Object.create(contextBase);
    context.canvas = this;
    return new Proxy(context, {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "string") return () => {};
        return undefined;
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    });
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";

  // Turbopack 运行时依赖 document.currentScript 取 basePath，jsdom 里它默认是 null
  const currentScriptDescriptor = Object.getOwnPropertyDescriptor(
    window.Document.prototype,
    "currentScript",
  );
  const fallbackScript = window.document.createElement("script");
  fallbackScript.src = baseUrl + "_next/static/chunks/turbopack-fallback.js";
  Object.defineProperty(window.Document.prototype, "currentScript", {
    configurable: true,
    get() {
      const real =
        currentScriptDescriptor && currentScriptDescriptor.get
          ? currentScriptDescriptor.get.call(this)
          : null;
      return real || fallbackScript;
    },
  });

  // 固定中文，保证按 zh-CN 文案定位元素稳定
  window.localStorage.setItem("parallax-locale", "zh-CN");
}

process.on("uncaughtException", (error) => {
  errors.push("uncaughtException: " + String(error && error.message).slice(0, 240));
});
process.on("unhandledRejection", (reason) => {
  errors.push("unhandledRejection: " + String(reason && reason.message ? reason.message : reason).slice(0, 240));
});

const dom = await JSDOM.fromURL(baseUrl, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse: installEnvironmentShims,
});

const window = dom.window;
const document = window.document;
const q = (selector) => Array.from(document.querySelectorAll(selector));
const click = (element) => {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
};
// React 的受控 input 只认原生 setter 触发的 input/change 事件
const setRangeValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, String(value));
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

const viewChips = () => q(".view-switch .legend-chip").filter((chip) => !chip.classList.contains("view-switch__toggle"));
const activeViewChip = () => viewChips().find((chip) => chip.classList.contains("is-active"));
const openToggle = () => document.querySelector(".view-switch__toggle");
const rows = () => q(".model-table__row");
const rowCount = () => rows().length;
const metricValues = () => q(".metric-grid__value").map((element) => element.textContent.trim());
const weightShares = () => q(".view-weights__value").map((element) => element.textContent.trim());
const weightSliders = () => q(".view-weights input[type=range]");
const kneeBadges = () => q(".knee-badge");
const tableCountBadge = () => document.querySelector(".model-table__count")?.textContent.trim() ?? "";
// 行数对不上时先怀疑 out/ 与 catalog.json 不是同批构建
const rowsDetail = (expectedValue) =>
  "实际 " + rowCount() + "，推导 " + expectedValue + "；若 out/ 早于 catalog.json 请先 npm run build";
const rowName = (row) => row.querySelector(".model-table__model strong")?.textContent.trim() ?? "";
const parseMoney = (text) => Number.parseFloat(String(text).replace(/[^0-9.]/g, ""));
const subsetNotice = () => document.querySelector(".view-switch__subset");

let exitCode = 1;
try {
  // —— 等待水合：动态导入的散点图挂载才算首屏真正跑起来 ——
  const hydrated = await waitFor(() => document.querySelector(".model-chart") !== null, 30000);
  console.log("\n=== 首屏水合 ===");
  check(
    "静态产物水合并挂载散点图",
    hydrated,
    hydrated ? "" : "等待 30s 仍没有 .model-chart；确认 out/ 与 catalog.json 是否同批构建",
  );
  if (!hydrated) {
    console.log("运行期错误: " + (errors.length ? errors.slice(0, 6).join(" || ") : "无"));
    exitCode = 1;
    throw new Error("水合失败，后续断言无意义");
  }

  console.log("\n=== 综合智能视角（默认） ===");
  const structureSelectors = [".site-header", ".hero", ".explorer", ".chart-card", ".model-table"];
  check(
    "主结构渲染",
    structureSelectors.every((selector) => document.querySelector(selector) !== null),
    structureSelectors.filter((selector) => document.querySelector(selector) === null).join(","),
  );
  // ECharts 挂载后再异步出图，这里等实际画布生成
  const chartDrawn = await waitFor(
    () => document.querySelectorAll(".model-chart svg").length > 0,
    15000,
  );
  check(
    "散点图已绘制",
    chartDrawn,
    "实际 svg " + document.querySelectorAll(".model-chart svg").length + " 个",
  );
  const searchBar = document.querySelector(".search-bar");
  const searchInput = searchBar?.querySelector(".model-search input");
  check("模型搜索框存在", searchInput !== null && searchInput !== undefined);
  check(
    "搜索框不再挂在区块标题行里",
    document.querySelector(".explorer__heading .model-search") === null,
  );
  // 搜索要能一直够得着：排在对照轴之后、图表之前
  const axisBeforeSearch =
    searchBar !== null &&
    document.querySelector(".axis-switch") !== null &&
    Boolean(searchBar.compareDocumentPosition(document.querySelector(".axis-switch")) & dom.window.Node.DOCUMENT_POSITION_PRECEDING);
  const searchBeforeGrid =
    searchBar !== null &&
    document.querySelector(".analysis-grid") !== null &&
    Boolean(searchBar.compareDocumentPosition(document.querySelector(".analysis-grid")) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  check("搜索条排在对照轴之后、图表之前", axisBeforeSearch && searchBeforeGrid);
  check("视角 chip 数量 >= 5", viewChips().length >= 5, "实际 " + viewChips().length);
  const chipLabels = viewChips().map((chip) => chip.textContent.trim());
  check(
    "五个视角标签齐全",
    VIEW_LABELS.every((label) => chipLabels.includes(label)),
    chipLabels.join(" / "),
  );
  check(
    "默认激活 chip 是第一个（综合智能）",
    viewChips()[0]?.classList.contains("is-active") === true &&
      (viewChips()[0]?.textContent ?? "").includes("综合"),
    "激活的是 " + (activeViewChip()?.textContent.trim() ?? "无"),
  );
  check(
    "表格行数等于该视角可比较模型数",
    rowCount() === expected.intelligence,
    rowsDetail(expected.intelligence),
  );
  check(
    "表格计数徽章与行数一致",
    Number.parseInt(tableCountBadge(), 10) === rowCount(),
    "徽章 " + tableCountBadge() + "，行数 " + rowCount(),
  );
  const heroNumbers = q(".hero__stats strong").map((element) => Number.parseInt(element.textContent.trim(), 10));
  check(
    "hero 统计与推导一致（全部/可比/厂商）",
    heroNumbers[0] === expected.total &&
      heroNumbers[1] === expected.intelligence &&
      heroNumbers[2] === expected.creators,
    "页面 " + heroNumbers.join("/") + "，推导 " + [expected.total, expected.intelligence, expected.creators].join("/"),
  );
  check("推荐卡存在", q(".recommendation-card").length >= 1 && q(".recommendation-card").length <= 5, "实际 " + q(".recommendation-card").length);
  check(
    "综合视角默认不画膝点（与原版一致）",
    kneeBadges().length === 0 && q(".model-table__row.is-knee").length === 0,
    "徽章 " + kneeBadges().length,
  );

  console.log("\n=== 切到纯编程 ===");
  const codingChip = viewChips().find((chip) => chip.textContent.trim() === VIEW_LABELS[1]);
  check("找到纯编程 chip", codingChip !== undefined);
  if (codingChip) click(codingChip);
  await waitFor(() => rowCount() === expected.coding, 8000);
  check("纯编程视角已激活", codingChip?.classList.contains("is-active") === true, "激活的是 " + (activeViewChip()?.textContent.trim() ?? "无"));
  check(
    "纯编程行数按推导值收敛",
    rowCount() === expected.coding,
    rowsDetail(expected.coding),
  );
  check(
    "子集提示出现且数字正确",
    subsetNotice() !== null && subsetNotice().textContent.includes(String(expected.coding)),
    subsetNotice()?.textContent.trim() ?? "无提示",
  );
  check("膝点徽章存在", kneeBadges().length >= 1, "实际 " + kneeBadges().length);
  check("表格标出膝点行", q(".model-table__row.is-knee").length >= 1, "实际 " + q(".model-table__row.is-knee").length);
  check("图表仍在", document.querySelector(".chart-card") !== null && document.querySelectorAll(".model-chart svg").length > 0);

  console.log("\n=== 自定义视角 + 拖动权重 ===");
  const customChip = viewChips().find((chip) => chip.textContent.trim() === VIEW_LABELS[4]);
  check("找到自定义 chip", customChip !== undefined);
  if (customChip) click(customChip);
  await waitFor(() => customChip?.classList.contains("is-active") === true, 5000);
  check("自定义视角已激活", customChip?.classList.contains("is-active") === true, "激活的是 " + (activeViewChip()?.textContent.trim() ?? "无"));
  check("自定义视角出现 5 支滑杆", weightSliders().length === PILLARS.length, "实际 " + weightSliders().length);
  check(
    "滑杆在自定义视角可交互",
    weightSliders().length === PILLARS.length && weightSliders().every((slider) => !slider.disabled),
    "disabled " + weightSliders().filter((slider) => slider.disabled).length + " 支",
  );
  check(
    "初始权重是默认自定义配比",
    weightShares().join("/") === expected.defaultShares.join("/"),
    "实际 " + weightShares().join("/") + "，推导 " + expected.defaultShares.join("/"),
  );

  const targetRow = rows().find((row) => rowName(row) === (dragTarget?.name ?? "")) ?? rows()[0];
  check("拖拽目标模型出现在表格中", targetRow !== undefined, "目标 " + (dragTarget?.name ?? "无"));
  if (targetRow) click(targetRow);
  await waitFor(() => document.querySelector(".selected-model__name")?.textContent.trim() === rowName(targetRow), 5000);
  const beforeScore = metricValues()[0];
  const beforeCost = metricValues()[1];
  check(
    "选中可比模型后指标卡显示数值",
    Number.isFinite(Number.parseFloat(beforeScore)) && Number.isFinite(parseMoney(beforeCost)),
    beforeScore + " / " + beforeCost,
  );

  const codingSlider = weightSliders()[0];
  if (codingSlider) setRangeValue(codingSlider, 90);
  await waitFor(() => weightShares().join("/") === expected.dragShares.join("/"), 5000);
  const afterScore = metricValues()[0];
  const afterCost = metricValues()[1];
  check(
    "拖动后权重按比例重分配",
    weightShares().join("/") === expected.dragShares.join("/"),
    "实际 " + weightShares().join("/") + "，推导 " + expected.dragShares.join("/"),
  );
  check("拖动后得分变化", afterScore !== beforeScore, beforeScore + " -> " + afterScore);
  check("拖动后成本变化", afterCost !== beforeCost, beforeCost + " -> " + afterCost);
  check(
    "拖动后模式标签仍是自定义",
    (document.querySelector(".view-weights__mode")?.textContent ?? "").includes(VIEW_LABELS[4]),
    document.querySelector(".view-weights__mode")?.textContent ?? "无",
  );
  check(
    "拖动后行数按推导值",
    rowCount() === expected.customDrag,
    rowsDetail(expected.customDrag),
  );
  if (dragTargetAfterMath && targetRow && rowName(targetRow) === dragTarget.name) {
    const derivedScore = Number.parseFloat(afterScore);
    const derivedCost = parseMoney(afterCost);
    const scoreOk = Number.isFinite(derivedScore) && Math.abs(derivedScore - dragTargetAfterMath.intelligence) <= 0.06;
    const costTolerance = dragTargetAfterMath.costPerTask < 0.1 ? 0.0006 : 0.006;
    const costOk = Number.isFinite(derivedCost) && Math.abs(derivedCost - dragTargetAfterMath.costPerTask) <= costTolerance;
    check(
      "拖动后指标与权重推导吻合",
      scoreOk && costOk,
      "页面 " + afterScore + " / " + afterCost + "，推导 " + dragTargetAfterMath.intelligence.toFixed(3) + " / " + dragTargetAfterMath.costPerTask.toFixed(4),
    );
  }

  console.log("\n=== 开源权重筛选 ===");
  const toggle = openToggle();
  check(
    "找到仅开源权重按钮",
    toggle !== null && (toggle.textContent ?? "").includes(OPEN_WEIGHTS_LABEL),
    toggle?.textContent.trim() ?? "无",
  );
  if (toggle) click(toggle);
  await waitFor(() => toggle?.getAttribute("aria-pressed") === "true", 5000);
  check("仅开源权重已开启", toggle?.getAttribute("aria-pressed") === "true");
  check(
    "开源筛选后行数下降且等于推导值",
    rowCount() === expected.openCustomDrag && rowCount() < expected.customDrag,
    rowsDetail(expected.openCustomDrag) + "（筛选前 " + expected.customDrag + "）",
  );
  if (toggle) click(toggle);
  await waitFor(() => toggle?.getAttribute("aria-pressed") === "false", 5000);
  check("关闭筛选后行数回到筛选前", rowCount() === expected.customDrag, rowsDetail(expected.customDrag));

  console.log("\n=== 切回综合智能 ===");
  const intelligenceChip = viewChips().find((chip) => chip.textContent.trim() === VIEW_LABELS[0]);
  check("找到综合智能 chip", intelligenceChip !== undefined);
  if (intelligenceChip) click(intelligenceChip);
  await waitFor(() => rowCount() === expected.intelligence, 8000);
  check(
    "切回综合视角行数复原",
    rowCount() === expected.intelligence,
    rowsDetail(expected.intelligence),
  );
  check("综合视角无子集提示", subsetNotice() === null);
  check(
    "综合视角权重面板锁定",
    weightSliders().length === PILLARS.length && weightSliders().every((slider) => slider.disabled),
    "可拖动 " + weightSliders().filter((slider) => !slider.disabled).length + " 支",
  );
  check("综合视角膝点重新隐藏", kneeBadges().length === 0, "实际 " + kneeBadges().length);

  console.log("\n=== 表格列头排序 ===");
  // 列定义来自 src/components/model-table.tsx 的 columns 表：rank/name/score/cost/speed/value/aaIndex/rankDelta 共 8 列
  const EXPECTED_TABLE_COLUMNS = [
    "#",
    "模型",
    "本视角得分",
    "每任务成本",
    "输出速度",
    "每美元得分",
    "AA 综合 v5",
    "排名变化",
  ];
  const tableHeaders = () => q(".model-table__sort");
  const headerLabels = () => tableHeaders().map((header) => header.textContent.replace(/[↑↓]/g, "").trim());
  check(
    "表格列头与 8 列定义一致",
    JSON.stringify(headerLabels()) === JSON.stringify(EXPECTED_TABLE_COLUMNS),
    "实际 " + headerLabels().join(" / "),
  );
  // 成本列按表头文字定位，避免加列后序号错位
  const costColumnIndex = headerLabels().indexOf("每任务成本");
  check("成本列可按表头定位", costColumnIndex >= 0, "index=" + costColumnIndex);
  const costColumn = () => rows().map((row) => parseMoney(row.children[costColumnIndex].textContent));
  const sortState = () => tableHeaders()[costColumnIndex]?.closest("th")?.getAttribute("aria-sort") ?? "";
  const clickCostHeader = () => {
    const header = tableHeaders()[costColumnIndex];
    if (header) click(header);
  };
  clickCostHeader();
  await waitFor(() => sortState() === "descending", 5000);
  const descendingCosts = costColumn();
  check(
    "点成本列头进入降序",
    sortState() === "descending" && descendingCosts.every((value, index) => index === 0 || descendingCosts[index - 1] >= value),
    "aria-sort=" + sortState() + "，首/末 " + descendingCosts[0] + " / " + descendingCosts[descendingCosts.length - 1],
  );
  clickCostHeader();
  await waitFor(() => sortState() === "ascending", 5000);
  const ascendingCosts = costColumn();
  check(
    "再点切换升序",
    sortState() === "ascending" && ascendingCosts.every((value, index) => index === 0 || ascendingCosts[index - 1] <= value),
    "aria-sort=" + sortState() + "，首/末 " + ascendingCosts[0] + " / " + ascendingCosts[ascendingCosts.length - 1],
  );
  check(
    "排序真实改变了首行",
    descendingCosts[0] !== ascendingCosts[0],
    descendingCosts[0] + " vs " + ascendingCosts[0],
  );

  console.log("\n=== 语言与主题开关 ===");
  check("主题切换按钮存在", document.querySelector(".theme-toggle") !== null);
  check("语言切换入口存在", document.querySelector(".locale-switcher__trigger") !== null);

  console.log("\n=== URL 状态 ===");
  // 每种链接参数都独立加载一次产物，避免上一个场景的交互污染下一个场景
  const openPage = async (search) => {
    const pageErrors = [];
    const pageConsole = new VirtualConsole();
    pageConsole.on("jsdomError", (error) => {
      pageErrors.push("jsdomError: " + String(error && error.message).slice(0, 240));
    });
    pageConsole.on("error", (...args) => {
      pageErrors.push("console.error: " + String(args[0]).slice(0, 240));
    });
    pageConsole.on("warn", () => {});
    const pageDom = await JSDOM.fromURL(baseUrl + search, {
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
      virtualConsole: pageConsole,
      beforeParse: installEnvironmentShims,
    });
    const pageWindow = pageDom.window;
    const pageDocument = pageWindow.document;
    const page = {
      dom: pageDom,
      window: pageWindow,
      document: pageDocument,
      errors: pageErrors,
      q: (selector) => Array.from(pageDocument.querySelectorAll(selector)),
    };
    page.rows = () => page.q(".model-table__row");
    page.rowCount = () => page.rows().length;
    page.viewChips = () => page.q(".view-switch .legend-chip").filter((chip) => !chip.classList.contains("view-switch__toggle"));
    page.activeChip = () => page.viewChips().find((chip) => chip.classList.contains("is-active"));
    page.weightLabels = () => page.q(".view-weights__label").map((element) => element.textContent.trim());
    page.weightShares = () => page.q(".view-weights__value").map((element) => element.textContent.trim());
    page.openToggle = () => pageDocument.querySelector(".view-switch__toggle");
    page.click = (element) => {
      element.dispatchEvent(new pageWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
    };
    page.ready = () => pageDocument.querySelector(".model-chart") !== null;
    extraPages.push(page);
    return page;
  };

  // 1. 链接指定视角：?view=coding 必须直接进入纯编程
  const codingViewPage = await openPage("?view=coding");
  await waitFor(() => codingViewPage.ready() && codingViewPage.rowCount() === expected.coding, 30000);
  check(
    "?view=coding 激活纯编程 chip",
    codingViewPage.activeChip()?.textContent.trim() === VIEW_LABELS[1],
    "激活的是 " + (codingViewPage.activeChip()?.textContent.trim() ?? "无"),
  );
  check(
    "?view=coding 行数=推导纯编程可比数",
    codingViewPage.rowCount() === expected.coding,
    "实际 " + codingViewPage.rowCount() + "，推导 " + expected.coding,
  );

  // 2. 链接打开仅开源权重：?open=1
  const openOnlyPage = await openPage("?open=1");
  await waitFor(
    () => openOnlyPage.ready() && openOnlyPage.openToggle()?.getAttribute("aria-pressed") === "true",
    30000,
  );
  check(
    "?open=1 打开仅开源权重",
    openOnlyPage.openToggle()?.getAttribute("aria-pressed") === "true",
    "aria-pressed=" + openOnlyPage.openToggle()?.getAttribute("aria-pressed"),
  );
  await waitFor(() => openOnlyPage.rowCount() === expected.openIntelligence, 5000);
  check(
    "?open=1 行数=推导开源可比数且少于综合视角",
    openOnlyPage.rowCount() === expected.openIntelligence && openOnlyPage.rowCount() < expected.intelligence,
    "实际 " + openOnlyPage.rowCount() + "，推导 " + expected.openIntelligence + "（综合视角 " + expected.intelligence + "）",
  );

  // 3. 链接携带自定义权重：?view=custom&w=coding:100
  const customWeightsPage = await openPage("?view=custom&w=coding:100");
  await waitFor(
    () => customWeightsPage.ready() && customWeightsPage.activeChip()?.textContent.trim() === VIEW_LABELS[4],
    30000,
  );
  check(
    "?view=custom&w=coding:100 激活自定义 chip",
    customWeightsPage.activeChip()?.textContent.trim() === VIEW_LABELS[4],
    "激活的是 " + (customWeightsPage.activeChip()?.textContent.trim() ?? "无"),
  );
  check(
    "?view=custom&w=coding:100 权重面板显示编程 100%",
    customWeightsPage.weightLabels().length === PILLARS.length &&
      (customWeightsPage.weightLabels()[0] ?? "").includes("Coding") &&
      customWeightsPage.weightShares().join("/") === codingOnlyShares.join("/"),
    "标签 " + customWeightsPage.weightLabels().join("/") + "，权重 " + customWeightsPage.weightShares().join("/") + "，推导 " + codingOnlyShares.join("/"),
  );

  // 4. 无参数加载：默认状态一个字符都不该写进地址栏
  const cleanPage = await openPage("");
  await waitFor(() => cleanPage.ready(), 30000);
  // 越过 200ms 防抖窗口再看，确认默认状态确实没有回写
  await sleep(400);
  check(
    "无参数加载地址栏保持空查询串",
    cleanPage.window.location.search === "",
    "location.search = " + JSON.stringify(cleanPage.window.location.search),
  );

  // 5. 交互回写地址栏：切到纯编程后出现 view=coding，且不新增历史条目
  const historyBefore = cleanPage.window.history.length;
  const cleanCodingChip = cleanPage.viewChips().find((chip) => chip.textContent.trim() === VIEW_LABELS[1]);
  check("无参数页面找到纯编程 chip", cleanCodingChip !== undefined);
  if (cleanCodingChip) cleanPage.click(cleanCodingChip);
  const viewWritten = await waitFor(() => cleanPage.window.location.search.includes("view=coding"), 5000);
  check(
    "点击纯编程后地址栏出现 view=coding",
    viewWritten && new URLSearchParams(cleanPage.window.location.search).get("view") === "coding",
    "location.search = " + JSON.stringify(cleanPage.window.location.search),
  );
  check(
    "地址栏同步不新增历史条目",
    cleanPage.window.history.length === historyBefore,
    "before " + historyBefore + "，after " + cleanPage.window.history.length,
  );

  // 6. 非法参数容错：未知视角、负数权重、不存在的模型都必须回落到默认
  const bogusPage = await openPage("?view=__bogus__&w=coding:-5&m=ghost");
  await waitFor(() => bogusPage.ready() && bogusPage.rowCount() === expected.intelligence, 30000);
  check(
    "非法参数回落到综合视角",
    bogusPage.activeChip()?.textContent.trim() === VIEW_LABELS[0],
    "激活的是 " + (bogusPage.activeChip()?.textContent.trim() ?? "无"),
  );
  check(
    "非法参数下落回默认行数",
    bogusPage.rowCount() === expected.intelligence,
    "实际 " + bogusPage.rowCount() + "，推导 " + expected.intelligence,
  );
  check(
    "非法参数不导致页面崩溃",
    bogusPage.document.querySelector(".site-header") !== null &&
      bogusPage.document.querySelector(".model-table") !== null &&
      bogusPage.ready(),
    "主结构缺失或图表未挂载",
  );

  const urlScenarioErrors = extraPages.flatMap((page) => page.errors);
  check(
    "URL 场景页面无 console.error / jsdomError",
    urlScenarioErrors.length === 0,
    urlScenarioErrors.slice(0, 5).join(" || "),
  );

  console.log("\n=== 对照轴 ===");
  const axisChips = () => q(".axis-switch .legend-chip");
  const axisChip = (label) => axisChips().find((chip) => chip.textContent.trim() === label);
  const isActiveAxis = (label) => axisChip(label)?.classList.contains("is-active") === true;
  const axisSubset = () => document.querySelector(".axis-switch__subset");
  const kneeTogglePressed = () => q('.chart-card__actions .chart-label-toggle[aria-pressed="true"]').length;
  const axisChipsSummary = () =>
    axisChips().map((chip) => (chip.classList.contains("is-active") ? "*" : "") + chip.textContent.trim()).join(" / ");
  // 两轴可比数相等时无需子集提示，那条断言直接跳过
  const speedIsSubset = speedExpected.rows < expected.intelligence;

  check(
    "对照轴默认激活能力/价格",
    axisChips().length === 2 && isActiveAxis(AXIS_LABELS.cost) && !isActiveAxis(AXIS_LABELS.speed),
    axisChipsSummary(),
  );
  check("表头文字包含输出速度", headerLabels().includes("输出速度"), headerLabels().join(" / "));

  const speedAxisChip = axisChip(AXIS_LABELS.speed);
  check("找到能力/速度 chip", speedAxisChip !== undefined);
  if (speedAxisChip) click(speedAxisChip);
  await waitFor(() => isActiveAxis(AXIS_LABELS.speed) && rowCount() === expected.intelligence, 8000);
  check(
    "点击能力/速度后切换对照轴",
    isActiveAxis(AXIS_LABELS.speed) && !isActiveAxis(AXIS_LABELS.cost),
    axisChipsSummary(),
  );
  check(
    "速度轴下图表仍在",
    document.querySelector(".chart-card") !== null && document.querySelectorAll(".model-chart svg").length > 0,
    "svg " + document.querySelectorAll(".model-chart svg").length + " 个",
  );
  check(
    "速度轴下表格行数不变",
    rowCount() === expected.intelligence,
    rowsDetail(expected.intelligence) + "（速度轴可比 " + speedExpected.rows + "）",
  );
  check(
    "速度轴下推荐卡数量=推导值",
    speedExpected.recommendations > 0 && q(".recommendation-card").length === speedExpected.recommendations,
    "实际 " + q(".recommendation-card").length + "，推导 " + speedExpected.recommendations,
  );
  check("速度轴下膝点徽章出现", kneeBadges().length >= 1, "实际 " + kneeBadges().length);
  check("速度轴下图内膝点开关激活", kneeTogglePressed() >= 1, "激活 " + kneeTogglePressed() + " 个");
  check(
    "速度轴下表格膝点行=推导交集数",
    q(".model-table__row.is-knee").length === speedExpected.kneeTableRows,
    "实际 " + q(".model-table__row.is-knee").length + "，推导 " + speedExpected.kneeTableRows,
  );
  if (speedIsSubset) {
    check(
      "速度轴下子集提示含推导数字",
      axisSubset() !== null && axisSubset().textContent.includes(String(speedExpected.rows)),
      axisSubset()?.textContent.trim() ?? "无提示",
    );
  } else {
    console.log("  SKIP 速度轴子集提示（两轴可比数相等，无需提示）");
  }

  const priceAxisChip = axisChip(AXIS_LABELS.cost);
  if (priceAxisChip) click(priceAxisChip);
  await waitFor(() => isActiveAxis(AXIS_LABELS.cost), 8000);
  check(
    "点回能力/价格后恢复激活",
    isActiveAxis(AXIS_LABELS.cost) && !isActiveAxis(AXIS_LABELS.speed),
    axisChipsSummary(),
  );
  check("点回价格轴后子集提示消失", axisSubset() === null);
  check(
    "点回价格轴后膝点恢复隐藏",
    kneeBadges().length === 0 && kneeTogglePressed() === 0,
    "徽章 " + kneeBadges().length + "，激活开关 " + kneeTogglePressed(),
  );

  // URL 直达：?axis=speed 必须一进来就是速度轴
  const pageAxisLabel = (page) =>
    page.q(".axis-switch .legend-chip").find((chip) => chip.classList.contains("is-active"))?.textContent.trim() ?? "无";
  const speedAxisPage = await openPage("?axis=speed");
  await waitFor(() => speedAxisPage.ready() && pageAxisLabel(speedAxisPage) === AXIS_LABELS.speed, 30000);
  check(
    "?axis=speed 直达速度轴",
    pageAxisLabel(speedAxisPage) === AXIS_LABELS.speed,
    "激活的是 " + pageAxisLabel(speedAxisPage),
  );
  check(
    "?axis=speed 表格行数=价格轴可比数",
    speedAxisPage.rowCount() === expected.intelligence,
    "实际 " + speedAxisPage.rowCount() + "，推导 " + expected.intelligence,
  );
  if (speedIsSubset) {
    const speedPageSubset = speedAxisPage.document.querySelector(".axis-switch__subset");
    check(
      "?axis=speed 子集提示含推导数字",
      speedPageSubset !== null && speedPageSubset.textContent.includes(String(speedExpected.rows)),
      speedPageSubset?.textContent.trim() ?? "无提示",
    );
  }

  const noAxisPage = await openPage("");
  await waitFor(() => noAxisPage.ready(), 30000);
  // 越过 200ms 防抖窗口，确认默认价格轴不会往地址栏写东西
  await sleep(400);
  check(
    "无参数加载仍是能力/价格轴且地址栏为空",
    pageAxisLabel(noAxisPage) === AXIS_LABELS.cost && noAxisPage.window.location.search === "",
    "激活 " + pageAxisLabel(noAxisPage) + "，location.search = " + JSON.stringify(noAxisPage.window.location.search),
  );

  const axisScenarioErrors = [speedAxisPage, noAxisPage].flatMap((page) => page.errors);
  check(
    "对照轴场景页面无 console.error / jsdomError",
    axisScenarioErrors.length === 0,
    axisScenarioErrors.slice(0, 5).join(" || "),
  );

  console.log("\n=== 运行期错误 ===");
  check(
    "运行期无 console.error / jsdomError",
    errors.length === 0,
    errors.length > 0 ? errors.slice(0, 5).join(" || ") : "",
  );
  if (errors.length > 0) {
    console.log("错误明细:");
    for (const entry of Array.from(new Set(errors)).slice(0, 10)) console.log("  " + entry);
  }
  if (warnings.length > 0) {
    console.log("运行期告警（不计失败）: " + warnings.length + " 条");
    for (const entry of Array.from(new Set(warnings)).slice(0, 5)) console.log("  " + entry);
  }

  exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  if (error instanceof Error && error.message === "水合失败，后续断言无意义") {
    console.log("\n首屏没有跑起来，跳过后续交互断言。");
  } else {
    console.log("\n测试执行中断: " + (error && error.message ? error.message : String(error)));
  }
  exitCode = 1;
} finally {
  console.log("\n结果: " + passed + " passed, " + failed + " failed");
  try {
    server.close();
  } catch {
    // 服务已关闭时忽略
  }
  try {
    for (const page of extraPages) page.dom.window.close();
  } catch {
    // 额外页面已关闭时忽略
  }
  try {
    window.close();
  } catch {
    // jsdom 窗口已关闭时忽略
  }
}

process.exit(exitCode);
