const NONEMPTY = (value) => typeof value === "string" && value.length > 0;
const FINITE = (value) => typeof value === "number" && Number.isFinite(value);

export function extractAaIndexMajor(html) {
  if (typeof html !== "string") return null;
  const headings = [
    ...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi),
    ...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi),
  ];
  const versions = new Set();
  for (const heading of headings) {
    const text = heading[1].replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ");
    const match = text.match(/\bArtificial\s+Analysis\s+Intelligence\s+Index\s+v(\d+)(?=\.|\b)/i);
    if (match) versions.add(Number(match[1]));
  }
  if (versions.size !== 1) return null;
  const version = [...versions][0];
  return Number.isSafeInteger(version) ? version : null;
}

function rscValues(html, key) {
  const chunks = [];
  const pattern = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }
  const stream = chunks.join("");
  const marker = JSON.stringify(key) + ":";
  const result = [];
  let offset = 0;
  while ((offset = stream.indexOf(marker, offset)) !== -1) {
    let start = offset + marker.length;
    while (/\s/.test(stream[start] ?? "")) start += 1;
    const opening = stream[start];
    if (opening !== "[" && opening !== "{") {
      offset = start;
      continue;
    }
    const stack = [];
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < stream.length; i += 1) {
      const char = stream[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === "[" || char === "{") {
        stack.push(char);
      } else if (char === "]" || char === "}") {
        const last = stack.pop();
        if ((last === "[" && char !== "]") || (last === "{" && char !== "}")) break;
        if (stack.length === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) throw new Error("AA 页面 " + key + " 数据不完整");
    try {
      result.push(JSON.parse(stream.slice(start, end)));
    } catch {
      throw new Error("AA 页面 " + key + " 数据无法解析");
    }
    offset = end;
  }
  return result;
}

export function extractAaReleaseModels(html) {
  const arrays = rscValues(html, "models").filter((value) =>
    Array.isArray(value) && value.length > 0 && value.every((model) => NONEMPTY(model?.slug)),
  );
  if (arrays.length !== 1) throw new Error("AA 发布列表缺少唯一的 models 数组");
  return arrays[0];
}

export function extractAaModelDetails(html, slug) {
  const current = rscValues(html, "currentModel").filter((model) => model?.slug === slug);
  if (current.length > 0) return current;
  return rscValues(html, "initialModels")
    .filter(Array.isArray)
    .flat()
    .filter((model) => model?.slug === slug);
}

function indexModels(models, label) {
  if (!Array.isArray(models)) throw new Error(label + "不是模型数组");
  const byId = new Map();
  const bySlug = new Map();
  for (const model of models) {
    if (!model || !NONEMPTY(model.id) || !NONEMPTY(model.slug)) {
      throw new Error(label + "包含缺少 id 或 slug 的模型");
    }
    if (bySlug.has(model.slug)) throw new Error(label + "包含重复 slug: " + model.slug);
    bySlug.set(model.slug, model);
    const marker = model.catalogIdentity;
    if (marker && (!NONEMPTY(marker.aaId) || !["aa-only", "parallax"].includes(marker.source) ||
        (marker.source === "parallax" && !NONEMPTY(marker.parallaxId)))) {
      throw new Error(label + "包含无效的 AA 身份信息: " + model.slug);
    }
    for (const id of new Set([model.id, marker?.aaId, marker?.parallaxId].filter(NONEMPTY))) {
      if (byId.has(id) && byId.get(id) !== model) throw new Error(label + "包含重复 id: " + id);
      byId.set(id, model);
    }
  }
  return { byId, bySlug };
}

function indexSource(rows, label, requireId) {
  if (!Array.isArray(rows)) throw new Error(label + "不是模型数组");
  const bySlug = new Map();
  const byId = new Map();
  for (const row of rows) {
    if (!row || !NONEMPTY(row.slug) || (requireId && !NONEMPTY(row.id))) {
      throw new Error(label + "包含缺少身份的模型");
    }
    if (bySlug.has(row.slug)) throw new Error(label + "包含重复 slug: " + row.slug);
    bySlug.set(row.slug, row);
    if (NONEMPTY(row.id)) {
      if (byId.has(row.id)) throw new Error(label + "包含重复 id: " + row.id);
      byId.set(row.id, row);
    }
  }
  return { bySlug, byId };
}

function selectExisting(index, id, slug, label, allowIdRename = false) {
  const byId = NONEMPTY(id) ? index.byId.get(id) : undefined;
  const bySlug = index.bySlug.get(slug);
  if (byId && bySlug && byId !== bySlug) throw new Error(label + "的 id 与 slug 指向不同模型: " + slug);
  if (byId && byId.slug !== slug && !bySlug && !allowIdRename) {
    throw new Error(label + "的 id 对应不同 slug，缺少已验证身份: " + slug);
  }
  return byId ?? bySlug;
}

function numericValue(values, fallback = null) {
  for (const value of values) if (FINITE(value)) return value;
  return values.some((value) => value !== undefined) ? null : fallback ?? null;
}

function mapAaModel(primary, leaderboard, previous) {
  const sources = [primary, leaderboard].filter(Boolean);
  const numeric = (field) => numericValue(sources.map((source) => source[field]));
  const inputPrice = numeric("price1mInputTokens");
  const outputPrice = numeric("price1mOutputTokens");
  const intelligence = numeric("intelligenceIndex");
  const openWeights = sources.find((source) => typeof source.isOpenWeights === "boolean")?.isOpenWeights;
  const reasoning = sources.find((source) => typeof source.isReasoning === "boolean")?.isReasoning;
  const model = {
    ...previous,
    id: previous?.id ?? primary.id,
    slug: primary.slug,
    name: primary.name ?? leaderboard?.name ?? previous?.name,
    creator: primary.creator?.name ?? leaderboard?.modelCreatorName ?? previous?.creator,
    creatorId: primary.creator?.id ?? previous?.creatorId ?? null,
    releaseDate: primary.releaseDate ?? previous?.releaseDate ?? null,
    reasoning: reasoning ?? previous?.reasoning ?? false,
    intelligence: intelligence === null ? null : Math.round(intelligence * 10) / 10,
    coding: previous?.coding ?? null,
    agentic: previous?.agentic ?? null,
    costPerTask: null,
    inputPrice,
    outputPrice,
    blendedPrice: inputPrice !== null && outputPrice !== null ? inputPrice * 0.75 + outputPrice * 0.25 : null,
    outputSpeed: numericValue([primary.outputSpeed, primary.headline?.outputSpeed, leaderboard?.outputSpeed]),
    latency: numericValue([primary.timeToFirstToken, primary.headline?.timeToFirstToken, leaderboard?.timeToFirstToken]),
    catalogIdentity: { source: "aa-only", aaId: primary.id },
  };
  delete model.dimensions;
  if (typeof openWeights === "boolean") model.aaOpenWeights = openWeights;
  else delete model.aaOpenWeights;
  if (!NONEMPTY(model.name) || !NONEMPTY(model.creator)) {
    throw new Error("AA 模型缺少名称或厂商: " + primary.slug);
  }
  for (const field of ["priceDataSource", "performanceDataSource"]) {
    if (primary[field] !== undefined) model[field] = primary[field];
  }
  delete model.aaStale;
  return model;
}

export async function mergeAaCatalog({ catalogModels, previousModels = [], intelligenceModels, releaseModels, leaderboardModels, fetchDetail, indexVersion, aaIndexMajor }) {
  const current = indexModels(catalogModels, "Parallax 目录");
  indexModels(previousModels, "旧目录");
  const intelligence = indexSource(intelligenceModels, "AA Intelligence 页", true);
  const releases = indexSource(releaseModels ?? [], "AA 发布列表", false);
  const leaderboard = indexSource(leaderboardModels ?? [], "AA 排行榜", false);
  const warnings = [];
  const comparableVersion = Number.isSafeInteger(indexVersion) && Number.isSafeInteger(aaIndexMajor) && indexVersion === aaIndexMajor;
  if (!comparableVersion) {
    warnings.push("AA 智能指数主版本与目录不一致或无法确认，AA 补充模型不参与综合排名");
  }
  const models = catalogModels.slice();
  const positions = new Map(models.map((model, index) => [model, index]));
  const taken = new Set();

  for (const previous of previousModels) {
    const marker = previous.catalogIdentity;
    if (!marker) continue;
    const sourceId = marker.source === "parallax" ? marker.parallaxId : marker.aaId;
    const aaAliases = [intelligence, releases, leaderboard]
      .map((source) => source.byId.get(marker.aaId))
      .filter(Boolean);
    const sourceMatch = current.byId.get(sourceId);
    const confirmedIdRename = marker.source === "parallax" || aaAliases.some((row) => row.slug === sourceMatch?.slug);
    const previousMatch = selectExisting(current, sourceId, previous.slug, "Parallax 目录", confirmedIdRename);
    const aliasMatches = new Set(aaAliases.map((row) => current.bySlug.get(row.slug)).filter(Boolean));
    if (aliasMatches.size > 1 || (previousMatch && aliasMatches.size && !aliasMatches.has(previousMatch))) {
      throw new Error("AA 模型 id 与 Parallax 别名指向不同模型: " + previous.slug);
    }
    const existing = previousMatch ?? aliasMatches.values().next().value;
    if (existing) {
      if (taken.has(existing)) throw new Error("多个旧模型指向同一个 Parallax 模型: " + existing.slug);
      taken.add(existing);
      const previousCreatorId = previous.creatorId ?? marker.aaCreatorId;
      if (NONEMPTY(previousCreatorId) && NONEMPTY(existing.creatorId) && previousCreatorId !== existing.creatorId) {
        throw new Error("Parallax 接管时厂商 id 不一致，拒绝按 slug 合并: " + previous.slug);
      }
      if ((!NONEMPTY(previousCreatorId) || !NONEMPTY(existing.creatorId)) && previous.creator !== existing.creator) {
        throw new Error("Parallax 接管时厂商名称不一致，拒绝按 slug 合并: " + previous.slug);
      }
      const replacement = {
        ...existing,
        id: previous.id,
        catalogIdentity: { source: "parallax", aaId: marker.aaId, parallaxId: existing.id },
      };
      delete replacement.aaStale;
      models[positions.get(existing)] = replacement;
    } else if (marker.source === "aa-only") {
      models.push({ ...previous, intelligence: comparableVersion ? previous.intelligence : null, aaStale: true });
    }
  }
  let index = indexModels(models, "合并后目录");
  const discoveryRows = new Map([...intelligence.bySlug, ...leaderboard.bySlug, ...releases.bySlug]);
  const detailSlugs = [...discoveryRows.values()].filter((row) => {
    const existing = index.bySlug.get(row.slug);
    const intel = intelligence.bySlug.get(row.slug);
    const board = leaderboard.bySlug.get(row.slug);
    if (existing) {
      const completeIntel = intel && FINITE(intel.intelligenceIndex) &&
        typeof intel.isOpenWeights === "boolean" && NONEMPTY(intel.creator?.name);
      return existing.catalogIdentity?.source === "aa-only" && releases.bySlug.has(row.slug) && !completeIntel;
    }
    return !intel || !NONEMPTY(intel.name ?? row.name) || !NONEMPTY(intel.creator?.name ?? board?.modelCreatorName);
  });
  const details = new Map();
  let nextDetail = 0;
  async function detailWorker() {
    while (nextDetail < detailSlugs.length) {
      const row = detailSlugs[nextDetail++];
      if (NONEMPTY(row.id) && NONEMPTY(row.name) && NONEMPTY(row.creator?.name)) {
        details.set(row.slug, row);
        continue;
      }
      let detailRows;
      try {
        detailRows = await fetchDetail(row.slug);
      } catch (error) {
        warnings.push(row.slug + ": AA 详情获取失败: " + String(error?.message ?? error));
        continue;
      }
      if (!Array.isArray(detailRows)) {
        warnings.push(row.slug + ": AA 详情不是模型列表");
        continue;
      }
      const exact = detailRows.filter((model) => model?.slug === row.slug);
      if (exact.length > 1) throw new Error("AA 详情包含重复 slug: " + row.slug);
      if (exact.length !== 1 || !NONEMPTY(exact[0].id)) {
        warnings.push(row.slug + ": AA 详情没有精确匹配的真实模型 id");
        continue;
      }
      details.set(row.slug, exact[0]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, detailSlugs.length) }, () => detailWorker()));

  const sourceSlugs = new Set([...intelligence.bySlug.keys(), ...releases.bySlug.keys(), ...leaderboard.bySlug.keys()]);
  const supplementalCandidates = [];
  for (const slug of sourceSlugs) {
    const intel = intelligence.bySlug.get(slug);
    const release = releases.bySlug.get(slug);
    const row = leaderboard.bySlug.get(slug);
    const detail = details.get(slug);
    const sourceIds = [intel?.id, release?.id, row?.id, detail?.id].filter(NONEMPTY);
    if (new Set(sourceIds).size > 1) throw new Error("AA 多个来源的模型 id 冲突: " + slug);
    const identityMatch = index.byId.get(sourceIds[0]);
    const sourceCreatorId = intel?.creator?.id ?? detail?.creator?.id;
    const sourceCreatorName = intel?.creator?.name ?? detail?.creator?.name ?? row?.modelCreatorName;
    const confirmedIdRename = identityMatch?.catalogIdentity?.aaId === sourceIds[0] ||
      (!identityMatch?.catalogIdentity && NONEMPTY(identityMatch?.creatorId) &&
        identityMatch.creatorId === sourceCreatorId);
    const existing = selectExisting(index, sourceIds[0], slug, "AA 模型", confirmedIdRename);
    if (existing && sourceIds.some((id) => index.byId.get(id) !== existing)) {
      throw new Error("AA 模型 id 与已有记录冲突: " + slug);
    }
    if (existing?.catalogIdentity?.source === "aa-only" && !intel && !row && !detail) continue;
    const enrichedIntel = intel && detail
      ? { ...detail, ...Object.fromEntries(Object.entries(intel).filter(([, value]) => value !== null && value !== undefined)),
          creator: { ...detail.creator, ...intel.creator } }
      : intel;
    const primary = enrichedIntel ?? detail ?? (existing?.catalogIdentity?.source === "aa-only"
      ? { ...release, ...row, id: existing.catalogIdentity.aaId, creator: { id: existing.creatorId, name: existing.creator } }
      : null);
    if (!primary) continue;
    const hasMetrics = [primary.intelligenceIndex, primary.price1mInputTokens, primary.price1mOutputTokens,
      primary.outputSpeed, primary.timeToFirstToken, primary.headline?.outputSpeed, primary.headline?.timeToFirstToken,
      row?.intelligenceIndex, row?.price1mInputTokens, row?.price1mOutputTokens, row?.outputSpeed, row?.timeToFirstToken].some(FINITE);
    if (existing?.catalogIdentity?.source === "aa-only" && !hasMetrics) continue;
    if (!NONEMPTY(primary.name ?? row?.name ?? existing?.name) ||
        !NONEMPTY(primary.creator?.name ?? row?.modelCreatorName ?? existing?.creator)) {
      warnings.push(slug + ": 缺少真实名称或厂商，无法收录");
      continue;
    }
    if (existing && NONEMPTY(existing.creatorId) && NONEMPTY(sourceCreatorId)) {
      if (existing.creatorId !== sourceCreatorId) throw new Error("AA 模型的厂商 id 与已有记录不一致: " + slug);
    } else if (existing) {
      if (NONEMPTY(existing.creator) && NONEMPTY(sourceCreatorName) && existing.creator !== sourceCreatorName) {
        throw new Error("AA 模型的厂商名称与已有记录不一致: " + slug);
      }
      if (existing.slug !== slug && (!NONEMPTY(existing.creator) || !NONEMPTY(sourceCreatorName))) {
        throw new Error("AA 模型改名时缺少可核实的厂商信息: " + slug);
      }
    }
    if (existing && existing.catalogIdentity?.source !== "aa-only") {
      if (!index.byId.has(primary.id) ||
          (existing.catalogIdentity && existing.catalogIdentity.aaId !== primary.id)) {
        throw new Error("AA 和 Parallax 的模型 id 冲突: " + slug);
      }
      continue;
    }
    if (existing && existing.catalogIdentity.aaId !== primary.id) {
      throw new Error("AA 模型 id 与已有记录冲突: " + slug);
    }
    const mapped = mapAaModel(primary, row, existing);
    if (!hasMetrics) mapped.aaStale = true;
    if (!comparableVersion) mapped.intelligence = null;
    if (existing) models[models.indexOf(existing)] = mapped;
    else models.push(mapped);
    index = indexModels(models, "合并后目录");
    if (!intel) supplementalCandidates.push(primary);
  }
  return { models, warnings: warnings.sort(), supplementalCandidates };
}
