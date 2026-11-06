import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { applyDimensions, buildDimensions } from "./build-data.mjs";

const checker = fileURLToPath(new URL("./check-data.mjs", import.meta.url));
const folders = [];
const pillars = { coding: 30, akw: 40, science: 50, reasoning: 60, knowledge: 70 };
const model = {
  id: "model-1", slug: "model-1", name: "Example", creator: "Example", creatorId: "creator-1",
  releaseDate: null, reasoning: false, intelligence: 42, coding: null, agentic: null,
  costPerTask: 1, inputPrice: 1, outputPrice: 1, blendedPrice: 1, outputSpeed: null, latency: null,
};
const catalog = (models = [model]) => ({
  models, syncedAt: "2026-11-06T00:00:00Z", refreshIntervalMs: 28800000, indexVersion: 5,
  source: { provider: "Artificial Analysis", url: "https://artificialanalysis.ai/", mode: "live", tier: "free" },
});
function temp() {
  const folder = mkdtempSync(join(tmpdir(), "code-pareto-data-"));
  folders.push(folder);
  return folder;
}
function report(value) {
  const path = join(temp(), "catalog.json");
  const before = JSON.stringify(value);
  writeFileSync(path, before);
  const result = spawnSync(process.execPath, [checker, path], {
    encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" },
  });
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(result.error).toBeUndefined();
  return result;
}
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

describe("advisory catalog diagnostics", () => {
  it("keeps a cost mismatch larger than the failed scheduled refresh without rejecting it", () => {
    const value = catalog([{ ...model, dimensions: { pillars, openWeights: false,
      pillarCosts: { coding: 8, akw: 8, science: 8, reasoning: 8, knowledge: 8 } } }]);
    const result = report(value);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::成本反算一致性");
    expect(result.stdout).toContain("700.00%");
    expect(result.stdout).toContain("不阻止更新");
  });
  it.each([{ models: [] }, { models: [{ ...model, costPerTask: null }] }])("reports low or zero coverage without failing: %j", ({ models }) => {
    const result = report(catalog(models));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("模型数量");
    expect(result.stdout).not.toContain("下限");
    expect(result.stdout).toContain("::warning::综合视角可比较");
  });
  it("reports outlier scores and nonpositive costs without changing their values", () => {
    const result = report(catalog([{ ...model, intelligence: -200, costPerTask: -500,
      dimensions: { openWeights: false, pillars: { ...pillars, coding: 1000, science: -100 },
        pillarCosts: { coding: 0, akw: -100, science: 2, reasoning: 2, knowledge: 2 } } }]));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning::dimensions 契约");
  });
  it("still distinguishes unreadable JSON from a data anomaly", () => {
    const path = join(temp(), "invalid.json");
    writeFileSync(path, "{");
    const result = spawnSync(process.execPath, [checker, path], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("解析失败");
  });
  it("does not couple report outcomes to the refresh rollback step", () => {
    const workflow = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const generate = workflow.split("- name: Generate catalog data")[1].split("- name: Restore catalog")[0];
    expect(generate).toContain("run: npm run data:build");
    expect(generate).not.toContain("data:check");
    const reportStep = workflow.split("- name: Report catalog data warnings")[1].split("- name:")[0];
    expect(reportStep).toContain("continue-on-error: true");
    expect(reportStep).toContain("run: npm run data:check");
    expect(workflow).toContain("if: steps.catalog.outcome == 'failure'");
  });
});

describe("warning-only refresh generation", () => {
  it("keeps finite upstream scores outside the historical range, including stale dimensions", () => {
    const input = { id: model.id, slug: model.slug, creator: { id: model.creatorId, name: model.creator },
      isOpenWeights: false, price1mInputTokens: null, price1mOutputTokens: null };
    const engineering = { ...input, subScores: { agenticTerminalUse: 130, agenticKnowledgeWork: -20,
      science: 50, reasoning: 60, knowledge: 70 } };
    const result = buildDimensions([input], [engineering], new Map([[model.slug, model]]));
    expect(result.problems).toEqual([]);
    expect(result.warnings.join(" ")).toContain("超出历史范围");
    const enriched = applyDimensions([model], result.dimensionsBySlug).models[0];
    expect(enriched.dimensions.pillars.coding).toBe(130);
    expect(enriched.dimensions.pillars.akw).toBe(-20);
    const stale = { ...enriched, aaStale: true };
    expect(applyDimensions([stale], new Map()).models[0].dimensions).toEqual(enriched.dimensions);
  });
  it.each(["offline", "empty", "sparse"])("publishes a new snapshot despite optional coverage changes (%s)", (coverage) => {
    const empty = coverage === "empty";
    const root = temp();
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src", "data"), { recursive: true });
    for (const filename of ["build-data.mjs", "aa-catalog-merge.mjs", "model-updates.mjs"]) {
      copyFileSync(new URL(filename, import.meta.url), join(root, "scripts", filename));
    }
    const output = join(root, "src", "data", "catalog.json");
    writeFileSync(output, JSON.stringify({ ...catalog(), syncedAt: "2026-11-05T08:00:00Z" }));
    const next = catalog(empty ? [] : [{ ...model, intelligence: 1000, costPerTask: -500 }]);
    const preload = join(root, "fetch.mjs");
    const rsc = (rows) => '<title>Artificial Analysis Intelligence Index v5</title><script>self.__next_f.push([1,' + JSON.stringify('"initialModels":' + JSON.stringify(rows)) + '])</script>';
    const aa = { id: model.id, slug: model.slug, name: model.name,
      creator: { id: model.creatorId, name: model.creator }, intelligenceIndex: 1000, isOpenWeights: false,
      price1mInputTokens: null, price1mOutputTokens: null };
    const engineering = { ...aa, subScores: { agenticTerminalUse: 130, agenticKnowledgeWork: -20,
      science: 50, reasoning: 60, knowledge: 70 } };
    const routes = { "/api/models": JSON.stringify(next) };
    if (coverage !== "offline") {
      routes["/evaluations/artificial-analysis-intelligence-index"] = rsc(empty ? [] : [aa]);
      routes["/indexes/engineering"] = rsc(empty ? [] : [engineering]);
    }
    writeFileSync(preload, "const routes=" + JSON.stringify(routes) + ";globalThis.fetch=async(url)=>{const body=routes[new URL(url).pathname];return new Response(body??'',{status:body===undefined?404:200})};");
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, join(root, "scripts", "build-data.mjs")], { encoding: "utf8", timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    if (coverage === "sparse") {
      expect(result.stdout).toContain("超出历史范围");
      next.models[0].dimensions = { pillars: { coding: 130, akw: -20, science: 50, reasoning: 60, knowledge: 70 },
        pillarCosts: null, openWeights: false };
    } else expect(result.stdout).toContain("继续更新");
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(next);
  });
});
