import type { ModelPoint, PillarKey, ViewKey } from "@/lib/models";

export const PILLARS: PillarKey[] = [
  "coding",
  "akw",
  "science",
  "reasoning",
  "knowledge",
];

/** 支柱的 i18n key，供 UI 层直接取用 */
export const PILLAR_I18N_KEYS: Record<PillarKey, string> = {
  coding: "view.pillar.coding",
  akw: "view.pillar.akw",
  science: "view.pillar.science",
  reasoning: "view.pillar.reasoning",
  knowledge: "view.pillar.knowledge",
};

export type PillarWeights = Record<PillarKey, number>;

export const DEFAULT_CUSTOM_WEIGHTS: PillarWeights = {
  coding: 0.6,
  akw: 0.4,
  science: 0,
  reasoning: 0,
  knowledge: 0,
};

/** 预设视角的权重。intelligence / custom 不走这里。 */
export const VIEW_PRESETS: Record<
  "coding" | "codingEngineering" | "aaEngineering",
  Partial<PillarWeights>
> = {
  // 纯编程：AA 的 Agentic Coding 子分数（FrontierCode 2.0 + Terminal-Bench 4.0 等权）
  coding: { coding: 1 },
  // 编程 + 工程：加 Agentic Knowledge Work
  codingEngineering: { coding: 0.6, akw: 0.4 },
  // AA 官方工程指数：知识 30 / 科研 20 / 推理 20 / 编程 15 / 工程协作 15
  aaEngineering: {
    knowledge: 0.3,
    science: 0.2,
    reasoning: 0.2,
    coding: 0.15,
    akw: 0.15,
  },
};

export const VIEW_ORDER: ViewKey[] = [
  "intelligence",
  "coding",
  "codingEngineering",
  "aaEngineering",
  "custom",
];

export const VIEW_I18N_KEYS: Record<ViewKey, string> = {
  intelligence: "view.chip.intelligence",
  coding: "view.chip.coding",
  codingEngineering: "view.chip.codingEngineering",
  aaEngineering: "view.chip.aaEngineering",
  custom: "view.chip.custom",
};

export const VIEW_HINT_I18N_KEYS: Record<ViewKey, string> = {
  intelligence: "view.hint.intelligence",
  coding: "view.hint.coding",
  codingEngineering: "view.hint.codingEngineering",
  aaEngineering: "view.hint.aaEngineering",
  custom: "view.hint.custom",
};

export function normalizeWeights(input: Partial<PillarWeights>): PillarWeights {
  const out = {} as PillarWeights;
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

export function weightsForView(
  view: ViewKey,
  customWeights: PillarWeights,
): PillarWeights | null {
  if (view === "intelligence") return null;
  if (view === "custom") return normalizeWeights(customWeights);
  return normalizeWeights(VIEW_PRESETS[view]);
}

/**
 * 把"视角"翻译成一组 ModelPoint：intelligence / costPerTask 被替换成该视角的得分与成本。
 * 这样图表、帕累托前沿、膝点、替代关系等既有逻辑全部零改动复用。
 * 综合视角原样返回，保证与 Parallax 原版 1:1。
 */
export function applyView(
  models: ModelPoint[],
  view: ViewKey,
  customWeights: PillarWeights,
): ModelPoint[] {
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

/** 某视角下有多少模型可上散点图（有得分、有正成本） */
export function countChartableForView(
  models: ModelPoint[],
  view: ViewKey,
  customWeights: PillarWeights,
): number {
  return applyView(models, view, customWeights).filter(
    (model) =>
      typeof model.intelligence === "number" &&
      Number.isFinite(model.intelligence) &&
      typeof model.costPerTask === "number" &&
      Number.isFinite(model.costPerTask) &&
      model.costPerTask > 0,
  ).length;
}

/** 视角是否只覆盖部分模型（编程/工程视角只有 AA 完整评测的模型） */
export function viewIsSubset(view: ViewKey): boolean {
  return view !== "intelligence";
}
