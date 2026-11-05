import { describe, expect, it, vi } from "vitest";
import { applyDimensions, buildDimensions } from "./build-data.mjs";
import { extractAaIndexMajor, extractAaModelDetails, extractAaReleaseModels, mergeAaCatalog } from "./aa-catalog-merge.mjs";
import { buildModelUpdates } from "./model-updates.mjs";

const aa = (id = "aa-1", slug = "new-model", fields = {}) => ({
  id, slug, name: "New Model", creator: { id: "creator-1", name: "Vendor" },
  releaseDate: "2026-11-03", isReasoning: true, isOpenWeights: false,
  intelligenceIndex: 34.555, price1mInputTokens: null, price1mOutputTokens: null,
  outputSpeed: null, ...fields,
});
const release = (slug = "new-model") => ({ slug, name: "New Model", releaseSlug: slug });
const board = (slug = "new-model", fields = {}) => ({
  slug, name: "New Model", modelCreatorName: "Vendor", ...fields,
});
const parallax = (id = "official-1", slug = "existing", fields = {}) => ({
  id, slug, name: "Official Model", creator: "Vendor", creatorId: "creator-1",
  releaseDate: null, reasoning: false, intelligence: 20, coding: null, agentic: null,
  costPerTask: null, inputPrice: null, outputPrice: null, blendedPrice: null,
  outputSpeed: null, latency: null, ...fields,
});
const merge = (fields = {}) => mergeAaCatalog({
  catalogModels: [], previousModels: [], intelligenceModels: [], releaseModels: [],
  leaderboardModels: [], indexVersion: 5, aaIndexMajor: 5,
  fetchDetail: async () => [], ...fields,
});
const rsc = (data) => '<script>self.__next_f.push([1,' + JSON.stringify(JSON.stringify(data)) + '])</script>';

describe("AA RSC discovery", () => {
  it("extracts release slugs including quoted brackets", () => {
    const models = [release("one"), { slug: "two", name: 'Name [with ] and "quotes"', releaseSlug: "two" }];
    expect(extractAaReleaseModels(rsc({ models }))).toEqual(models);
  });

  it("prefers exact currentModel and falls back to an exact initialModels item", () => {
    const target = aa();
    const other = aa("different", "other");
    const html = rsc({ currentModel: target, initialModels: [other, { ...target, id: "secondary" }] });
    expect(extractAaModelDetails(html, target.slug)).toEqual([target]);
    expect(extractAaModelDetails(rsc({ currentModel: other, initialModels: [other, target] }), target.slug)).toEqual([target]);
    expect(extractAaModelDetails(rsc({ initialModels: [other] }), target.slug)).toEqual([]);
  });

  it("rejects missing or ambiguous release arrays", () => {
    expect(() => extractAaReleaseModels(rsc({ models: [] }))).toThrow();
    expect(() => extractAaReleaseModels(rsc({ a: { models: [release("a")] }, b: { models: [release("b")] } }))).toThrow();
  });

  it("recognizes matching title versions and rejects unknown or conflicting versions", () => {
    expect(extractAaIndexMajor('<title>Artificial Analysis Intelligence Index v5.0.1 | AA</title><h1>Artificial Analysis Intelligence Index v5.0.1</h1>')).toBe(5);
    expect(extractAaIndexMajor('<h1>Artificial Analysis Intelligence Index v6.1</h1>')).toBe(6);
    expect(extractAaIndexMajor('<title>Intelligence Index</title>')).toBeNull();
    expect(extractAaIndexMajor('<title>Artificial Analysis Intelligence Index v5.0</title><h1>Artificial Analysis Intelligence Index v6.0</h1>')).toBeNull();
  });
});

describe("AA catalog merging", () => {
  it("adds an intelligence model with its real id and preserves missing values", async () => {
    const input = aa();
    const result = await merge({ intelligenceModels: [input], releaseModels: [release()] });
    expect(result.models).toEqual([expect.objectContaining({
      id: "aa-1", slug: "new-model", name: "New Model", creator: "Vendor", creatorId: "creator-1",
      releaseDate: "2026-11-03", reasoning: true, intelligence: 34.6,
      coding: null, agentic: null, costPerTask: null, inputPrice: null, outputPrice: null,
      blendedPrice: null, outputSpeed: null, latency: null, aaOpenWeights: false,
      catalogIdentity: { source: "aa-only", aaId: "aa-1" },
    })]);
    expect(result.models[0]).not.toHaveProperty("dimensions");
    expect(result.models[0]).not.toHaveProperty("aaStale");
  });

  it("resolves only unknown release slugs and fills prices and performance from real fields", async () => {
    const existing = parallax();
    const detail = aa("aa-2", "detail-only", {
      intelligenceIndex: 40.5266, price1mInputTokens: 4, price1mOutputTokens: 20,
      headline: { outputSpeed: 126.2, timeToFirstToken: 8.9 },
      priceDataSource: { type: "firstParty", providerName: "Vendor" },
    });
    const fetchDetail = vi.fn(async () => [aa("other", "other"), detail]);
    const result = await merge({
      catalogModels: [existing], releaseModels: [release("existing"), release("detail-only")],
      leaderboardModels: [board("detail-only", { outputSpeed: 126.2 })], fetchDetail,
    });
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledWith("detail-only");
    expect(result.models).toEqual([existing, expect.objectContaining({
      id: "aa-2", intelligence: 40.5, inputPrice: 4, outputPrice: 20, blendedPrice: 8,
      outputSpeed: 126.2, latency: 8.9, costPerTask: null,
      priceDataSource: { type: "firstParty", providerName: "Vendor" },
    })]);
  });

  it("queries details when a new intelligence record lacks required identity fields", async () => {
    const fetchDetail = vi.fn(async () => [aa()]);
    const incomplete = aa("aa-1", "new-model", { creator: null });
    const result = await merge({ intelligenceModels: [incomplete], releaseModels: [release()], fetchDetail });
    expect(fetchDetail).toHaveBeenCalledWith("new-model");
    expect(result.models[0]).toEqual(expect.objectContaining({ id: "aa-1", creator: "Vendor", creatorId: "creator-1" }));
  });

  it("uses leaderboard as discovery fallback when releases are unavailable", async () => {
    const fetchDetail = vi.fn(async () => [aa("aa-2", "leader-only")]);
    const result = await merge({ leaderboardModels: [board("leader-only")], fetchDetail });
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(result.models.map((model) => model.slug)).toEqual(["leader-only"]);
  });

  it("warns and skips a new model when its exact detail or real id is unavailable", async () => {
    const wrongSlug = await merge({ releaseModels: [release()], fetchDetail: async () => [aa("aa-2", "other")] });
    expect(wrongSlug.models).toEqual([]);
    expect(wrongSlug.warnings.join(" ")).toContain("真实模型 id");
    const failed = await merge({ releaseModels: [release()], fetchDetail: async () => { throw new Error("offline"); } });
    expect(failed.models).toEqual([]);
    expect(failed.warnings.join(" ")).toContain("offline");
  });

  it("retains AA-only entries when all sources miss them and keeps them stale while only releases list them", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const stale = await merge({ previousModels: initial.models });
    expect(stale.models[0]).toEqual(expect.objectContaining({ id: "aa-1", intelligence: 34.6, aaStale: true }));
    const releasesOnly = await merge({ previousModels: initial.models, releaseModels: [release()] });
    expect(releasesOnly.models[0]).toEqual(expect.objectContaining({ aaStale: true, intelligence: 34.6 }));
    const recovered = await merge({ previousModels: releasesOnly.models, leaderboardModels: [board("new-model", { intelligenceIndex: 30 })] });
    expect(recovered.models[0]).not.toHaveProperty("aaStale");
    const rediscovered = await merge({ previousModels: recovered.models, intelligenceModels: [aa()] });
    expect(rediscovered.models[0]).not.toHaveProperty("aaStale");
    expect(rediscovered.models[0].intelligence).toBe(34.6);
    expect(rediscovered.models[0].catalogIdentity).toEqual({ source: "aa-only", aaId: "aa-1" });
  });

  it("is byte-stable when the same AA-only snapshot is generated again", async () => {
    const input = { intelligenceModels: [aa()], releaseModels: [release()] };
    const first = await merge(input);
    const second = await merge({ ...input, previousModels: first.models });
    expect(JSON.stringify(second.models)).toBe(JSON.stringify(first.models));
  });

  it("uses fresh leaderboard metrics for a known AA-only model without fetching details", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const fetchDetail = vi.fn(async () => []);
    const refreshed = await merge({
      previousModels: initial.models, releaseModels: [release()], fetchDetail,
      leaderboardModels: [board("new-model", { intelligenceIndex: 35.21, price1mInputTokens: 1, price1mOutputTokens: 3, outputSpeed: 70 })],
    });
    expect(fetchDetail).toHaveBeenCalledWith("new-model");
    expect(refreshed.models[0]).toEqual(expect.objectContaining({
      id: "aa-1", creatorId: "creator-1", releaseDate: "2026-11-03", intelligence: 35.2,
      inputPrice: 1, outputPrice: 3, blendedPrice: 1.5, outputSpeed: 70,
    }));
    expect(refreshed.models[0]).not.toHaveProperty("aaStale");
  });

  it("retries detail for existing release-only AA models and accepts newly reported metrics", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const unavailable = await merge({ previousModels: initial.models, releaseModels: [release()], fetchDetail: async () => { throw new Error("offline"); } });
    expect(unavailable.models[0]).toEqual(expect.objectContaining({ aaStale: true, intelligence: 34.6 }));
    expect(unavailable.warnings.join(" ")).toContain("offline");
    const fetchDetail = vi.fn(async () => [aa("aa-1", "new-model", { outputSpeed: 91, price1mInputTokens: 2, price1mOutputTokens: 6 })]);
    const available = await merge({ previousModels: unavailable.models, releaseModels: [release()], fetchDetail });
    expect(fetchDetail).toHaveBeenCalledWith("new-model");
    expect(available.models[0]).toEqual(expect.objectContaining({ intelligence: 34.6, outputSpeed: 91, inputPrice: 2, outputPrice: 6 }));
    expect(available.models[0]).not.toHaveProperty("aaStale");
  });

  it("supplements leaderboard models from details and falls back to confirmed leaderboard fields", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const fetchDetail = vi.fn(async () => [aa("aa-1", "new-model", { outputSpeed: 99 })]);
    const result = await merge({ previousModels: initial.models, releaseModels: [release()], leaderboardModels: [board("new-model", { intelligenceIndex: 35 })], fetchDetail });
    expect(fetchDetail).toHaveBeenCalledWith("new-model");
    expect(result.models[0].outputSpeed).toBe(99);
    const fallback = await merge({ previousModels: initial.models, releaseModels: [release()], leaderboardModels: [board("new-model", { intelligenceIndex: 35 })], fetchDetail: async () => { throw new Error("offline"); } });
    expect(fallback.models[0]).toEqual(expect.objectContaining({ intelligence: 35, outputSpeed: null, latency: null }));
    expect(fallback.models[0]).not.toHaveProperty("aaStale");
    expect(fallback.warnings.join(" ")).toContain("offline");
  });

  it("does not keep stale prices or performance when fresh sources omit them", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "new-model", {
      price1mInputTokens: 4, price1mOutputTokens: 20, headline: { outputSpeed: 100, timeToFirstToken: 5 },
    })] });
    expect(initial.models[0]).toEqual(expect.objectContaining({ inputPrice: 4, outputPrice: 20, outputSpeed: 100, latency: 5 }));
    const refreshed = await merge({ previousModels: initial.models, intelligenceModels: [aa()] });
    expect(refreshed.models[0]).toEqual(expect.objectContaining({
      intelligence: 34.6, inputPrice: null, outputPrice: null, blendedPrice: null, outputSpeed: null, latency: null,
    }));
    expect(refreshed.models[0]).not.toHaveProperty("aaStale");
  });

  it("rejects a Parallax takeover whose creator contradicts the AA record", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const wrongCreator = parallax("official-2", "new-model", { intelligence: 55, creatorId: "someone-else" });
    await expect(merge({ catalogModels: [wrongCreator], previousModels: initial.models })).rejects.toThrow(/厂商 id 不一致/);
    const mismatchedNames = { ...initial.models[0], creatorId: null, creator: "Vendor" };
    const nameless = parallax("official-2", "new-model", { creatorId: null, creator: "Other vendor" });
    await expect(merge({ catalogModels: [nameless], previousModels: [mismatchedNames] })).rejects.toThrow(/厂商名称不一致/);
    await expect(merge({ catalogModels: [nameless], previousModels: initial.models })).rejects.toThrow(/厂商名称不一致/);
  });

  it("matches an AA slug rename by verified AA id and keeps the published identity", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const renamed = await merge({ previousModels: initial.models, intelligenceModels: [aa("aa-1", "new-slug")] });
    expect(renamed.models).toHaveLength(1);
    expect(renamed.models[0]).toEqual(expect.objectContaining({
      id: "aa-1", slug: "new-slug", creatorId: "creator-1", catalogIdentity: { source: "aa-only", aaId: "aa-1" },
    }));
    const repeated = await merge({ previousModels: renamed.models, intelligenceModels: [aa("aa-1", "new-slug")] });
    expect(repeated.models).toEqual(renamed.models);
    const firstEvents = buildModelUpdates({ models: [] }, { models: initial.models }, { events: [] }, "2026-11-04T00:00:00Z");
    const laterEvents = buildModelUpdates({ models: initial.models }, { models: renamed.models }, firstEvents, "2026-11-05T00:00:00Z");
    expect(laterEvents.events.filter((event) => event.kind === "added")).toHaveLength(1);
  });

  it("keeps a distinct site id when the recorded AA id is renamed", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const prior = { ...initial.models[0], id: "site-1" };
    const renamed = await merge({ previousModels: [prior], intelligenceModels: [aa("aa-1", "new-slug")] });
    expect(renamed.models).toHaveLength(1);
    expect(renamed.models[0]).toEqual(expect.objectContaining({
      id: "site-1", slug: "new-slug", catalogIdentity: { source: "aa-only", aaId: "aa-1" },
    }));
    const repeated = await merge({ previousModels: renamed.models, intelligenceModels: [aa("aa-1", "new-slug")] });
    expect(repeated.models).toEqual(renamed.models);
  });

  it("requires matching creator names for a rename when creator ids are missing", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const prior = { ...initial.models[0], creatorId: null };
    const fresh = (name) => aa("aa-1", "new-slug", { creator: { id: null, name } });
    const renamed = await merge({ previousModels: [prior], intelligenceModels: [fresh("Vendor")] });
    expect(renamed.models[0].id).toBe("aa-1");
    await expect(merge({ previousModels: [prior], intelligenceModels: [fresh("Other")] })).rejects.toThrow(/厂商名称/);
    await expect(merge({ previousModels: [prior], intelligenceModels: [fresh(null)] })).rejects.toThrow(/厂商信息/);
  });

  it("matches a renamed release-only model through its detail page", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const fetchDetail = vi.fn(async () => [aa("aa-1", "new-slug", { outputSpeed: 91 })]);
    const renamed = await merge({ previousModels: initial.models, releaseModels: [release("new-slug")], fetchDetail });
    expect(fetchDetail).toHaveBeenCalledWith("new-slug");
    expect(renamed.models).toHaveLength(1);
    expect(renamed.models[0]).toEqual(expect.objectContaining({ id: "aa-1", slug: "new-slug", outputSpeed: 91 }));
    expect(renamed.models[0]).not.toHaveProperty("aaStale");
  });

  it("rejects a Parallax alias when the old and new slugs match different models", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    await expect(merge({
      previousModels: initial.models,
      catalogModels: [parallax("other-id", "old-slug"), parallax("official-id", "new-slug")],
      intelligenceModels: [aa("aa-1", "new-slug")],
    })).rejects.toThrow(/别名指向不同模型/);
  });

  it("rejects an AA identity rename with a contradictory creator id", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const conflicting = aa("aa-1", "new-slug", { creator: { id: "other-creator", name: "Other" } });
    await expect(merge({ previousModels: initial.models, intelligenceModels: [conflicting] })).rejects.toThrow(/厂商/);
  });

  it("keeps separate models when only their names match", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const other = await merge({ previousModels: initial.models, intelligenceModels: [aa("aa-2", "new-slug")] });
    expect(other.models.map((model) => model.id).sort()).toEqual(["aa-1", "aa-2"]);
  });

  it("preserves the site id when Parallax adopts a model after an AA slug rename", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    for (const parallaxId of ["aa-1", "official-2"]) {
      const official = parallax(parallaxId, "new-slug", { intelligence: 55 });
      const fresh = aa("aa-1", "new-slug");
      const adopted = await merge({ catalogModels: [official], previousModels: initial.models, intelligenceModels: [fresh] });
      expect(adopted.models).toHaveLength(1);
      expect(adopted.models[0]).toEqual(expect.objectContaining({
        id: "aa-1", slug: "new-slug", intelligence: 55,
        catalogIdentity: { source: "parallax", aaId: "aa-1", parallaxId },
      }));
      const repeated = await merge({ catalogModels: [official], previousModels: adopted.models, intelligenceModels: [fresh] });
      expect(repeated.models).toEqual(adopted.models);
    }
  });

  it("rejects an AA rename if the new slug already belongs to another model", async () => {
    const initial = await merge({ intelligenceModels: [aa("aa-1", "old-slug")] });
    const other = parallax("other-id", "new-slug");
    await expect(merge({
      catalogModels: [other], previousModels: initial.models,
      intelligenceModels: [aa("aa-1", "new-slug", { creator: { id: "different", name: "Someone else" } })],
    })).rejects.toThrow();
  });

  it("does not treat a Parallax id as a different recorded AA id", async () => {
    const official = parallax("site-id", "old-slug", {
      catalogIdentity: { source: "parallax", aaId: "aa-1", parallaxId: "official-2" },
    });
    for (const slug of ["old-slug", "new-slug"]) {
      await expect(merge({ catalogModels: [official], intelligenceModels: [aa("official-2", slug)] })).rejects.toThrow(/id/);
    }
  });

  it("matches an unmarked Parallax id with a renamed AA slug only when the creator id agrees", async () => {
    const official = parallax("aa-1", "old-slug");
    const renamed = await merge({ catalogModels: [official], intelligenceModels: [aa("aa-1", "new-slug")] });
    expect(renamed.models).toEqual([official]);
    const unknownCreator = { ...official, creatorId: null };
    await expect(merge({ catalogModels: [unknownCreator], intelligenceModels: [aa("aa-1", "new-slug")] })).rejects.toThrow(/已验证身份/);
  });

  it("lets Parallax take over the same id and removes stale status", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const stale = await merge({ previousModels: initial.models });
    const official = parallax("aa-1", "new-model", { intelligence: 55 });
    const result = await merge({ catalogModels: [official], previousModels: stale.models, intelligenceModels: [aa()] });
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toEqual(expect.objectContaining({
      id: "aa-1", intelligence: 55, catalogIdentity: { source: "parallax", aaId: "aa-1", parallaxId: "aa-1" },
    }));
    expect(result.models[0]).not.toHaveProperty("aaStale");
  });

  it("keeps the published id when Parallax takes over with a different id across refreshes", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    const official = parallax("official-2", "new-model", { intelligence: 55 });
    const adopted = await merge({ catalogModels: [official], previousModels: initial.models, intelligenceModels: [aa()] });
    const repeated = await merge({ catalogModels: [official], previousModels: adopted.models, intelligenceModels: [aa()] });
    expect(adopted.models).toEqual(repeated.models);
    expect(repeated.models[0]).toEqual(expect.objectContaining({
      id: "aa-1", intelligence: 55,
      catalogIdentity: { source: "parallax", aaId: "aa-1", parallaxId: "official-2" },
    }));
    const firstEvents = buildModelUpdates({ models: [] }, { models: initial.models }, { events: [] }, "2026-11-04T00:00:00Z");
    const laterEvents = buildModelUpdates({ models: initial.models }, { models: repeated.models }, firstEvents, "2026-11-05T00:00:00Z");
    expect(laterEvents.events.filter((event) => event.kind === "added")).toHaveLength(1);
    expect(laterEvents.events.find((event) => event.kind === "added").modelId).toBe(repeated.models[0].id);
  });

  it("clears AA-only scores for mismatched or unknown index versions including retained entries", async () => {
    const initial = await merge({ intelligenceModels: [aa()] });
    for (const aaIndexMajor of [6, null]) {
      const result = await merge({ previousModels: initial.models, intelligenceModels: [aa()], aaIndexMajor });
      expect(result.models[0].intelligence).toBeNull();
      expect(result.warnings.join(" ")).toContain("主版本");
      const stale = await merge({ previousModels: initial.models, aaIndexMajor });
      expect(stale.models[0]).toEqual(expect.objectContaining({ intelligence: null, aaStale: true }));
    }
    const official = parallax("official", "other", { intelligence: 77 });
    const mismatch = await merge({ catalogModels: [official], intelligenceModels: [aa()], aaIndexMajor: 6 });
    expect(mismatch.models[0].intelligence).toBe(77);
  });

  it("rejects duplicate and conflicting identities instead of guessing", async () => {
    await expect(merge({ catalogModels: [parallax("x", "a"), parallax("x", "b")] })).rejects.toThrow(/重复 id/);
    await expect(merge({ releaseModels: [release("a"), release("a")] })).rejects.toThrow(/重复 slug/);
    await expect(merge({ intelligenceModels: [aa("a", "a"), aa("a", "b")] })).rejects.toThrow(/重复 id/);
    await expect(merge({ catalogModels: [parallax("old", "new-model")], intelligenceModels: [aa()] })).rejects.toThrow(/冲突/);
    await expect(merge({ intelligenceModels: [aa()], leaderboardModels: [board("new-model", { id: "different" })] })).rejects.toThrow(/冲突/);
    await expect(merge({ releaseModels: [release()], fetchDetail: async () => [aa("a"), aa("b")] })).rejects.toThrow(/重复 slug/);
  });
});

describe("dimension output", () => {
  const scored = { ...parallax("p-1", "scored", { intelligence: 30 }), catalogIdentity: { source: "aa-only", aaId: "aa-1" } };
  const complete = { pillars: { coding: 1, akw: 2, science: 3, reasoning: 4, knowledge: 5 }, pillarCosts: null, openWeights: false };

  it("writes dimensions only when pillars, openWeights and intelligence are all available", () => {
    const dimensionsBySlug = new Map([["scored", complete]]);
    const result = applyDimensions([scored], dimensionsBySlug);
    expect(result.merged).toBe(1);
    expect(result.models[0].dimensions).toEqual(complete);
    const unversioned = applyDimensions([{ ...scored, intelligence: null }], dimensionsBySlug);
    expect(unversioned.merged).toBe(0);
    expect(unversioned.models[0]).not.toHaveProperty("dimensions");
  });

  it("retains complete stale AA dimensions but removes incomplete or fresh leftovers", () => {
    const stale = { ...scored, aaStale: true, dimensions: complete };
    expect(applyDimensions([stale], new Map()).models[0].dimensions).toEqual(complete);
    const incomplete = { ...scored, aaStale: true, dimensions: { ...complete, pillars: null } };
    expect(applyDimensions([incomplete], new Map()).models[0]).not.toHaveProperty("dimensions");
    const freshLeftover = { ...scored, dimensions: complete };
    expect(applyDimensions([freshLeftover], new Map()).models[0]).not.toHaveProperty("dimensions");
  });
});

describe("engineering data fallback", () => {
  it("warns and keeps base data when the engineering model is missing", () => {
    const model = aa();
    const result = buildDimensions([model], [], new Map([[model.slug, model]]));
    expect(result.problems).toEqual([]);
    expect(result.dimensionsBySlug.size).toBe(0);
    expect(result.warnings.join(" ")).toContain("缺少同 id");
  });

  it("joins engineering data to the catalog by AA id when source slugs differ", () => {
    const model = aa("aa-1", "aa-new");
    const engineering = {
      id: "aa-1", slug: "engineering-old", creator: { id: "creator-1" },
      subScores: { agenticTerminalUse: 10, agenticKnowledgeWork: 20, science: 30, reasoning: 40, knowledge: 50 },
    };
    const catalog = parallax("aa-1", "catalog-old", { intelligence: 30 });
    const result = buildDimensions([model], [engineering], new Map([[catalog.slug, catalog]]));
    expect(result.dimensionsBySlug.get("catalog-old")).toEqual(expect.objectContaining({
      pillars: { coding: 10, akw: 20, science: 30, reasoning: 40, knowledge: 50 },
    }));
    expect(applyDimensions([catalog], result.dimensionsBySlug).models[0].dimensions).toBeDefined();
  });

  it("rejects a different model occupying the AA slug during an id-based join", () => {
    const model = aa("aa-1", "aa-new");
    const engineering = { id: "aa-1", slug: "engineering-old", creator: { id: "creator-1" } };
    const catalog = parallax("aa-1", "catalog-old");
    const other = parallax("aa-2", "aa-new");
    expect(() => buildDimensions([model], [engineering], new Map([[catalog.slug, catalog], [other.slug, other]]))).toThrow(/冲突/);
  });

  it("treats missing subScores as unavailable but rejects contradictory identities", () => {
    const model = aa();
    const result = buildDimensions([model], [{ id: model.id, slug: model.slug, subScores: {} }], new Map([[model.slug, model]]));
    expect(result.problems).toEqual([]);
    expect(result.dimensionsBySlug.has(model.slug)).toBe(false);
    expect(result.warnings.join(" ")).toContain("缺失");
    expect(() => buildDimensions([model], [{ id: "other", slug: model.slug }], new Map([[model.slug, model]]))).toThrow(/冲突/);
  });
});
