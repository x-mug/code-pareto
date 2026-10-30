export const CATALOG_REFRESH_HOURS = 8;
export const CATALOG_REFRESH_SECONDS = CATALOG_REFRESH_HOURS * 60 * 60;
export const CATALOG_REFRESH_MS = CATALOG_REFRESH_SECONDS * 1000;

export type SourceMode = "live" | "demo";

/** 能力支柱：与 Artificial Analysis Engineering Index 的子分数一一对应。 */
export type PillarKey = "coding" | "akw" | "science" | "reasoning" | "knowledge";

/** 视角：默认综合指数，其余为只关心编程/工程时使用的再组合。 */
export type ViewKey =
  | "intelligence"
  | "coding"
  | "codingEngineering"
  | "aaEngineering"
  | "custom";

export interface ModelViewDimensions {
  /** 每支支柱 0–100，直接来自 AA 官方子分数 */
  pillars: Record<PillarKey, number> | null;
  /** 每支支柱的"每任务成本"（USD），按 AA 的 token 消耗 × 价格复算 */
  pillarCosts: Record<PillarKey, number> | null;
  openWeights: boolean | null;
}
export type SourceNoticeKey = "missingApiKey" | "apiError" | "unavailable";

export interface ModelPoint {
  id: string;
  slug: string;
  name: string;
  creator: string;
  creatorId: string | null;
  releaseDate: string | null;
  reasoning: boolean;
  intelligence: number | null;
  coding: number | null;
  agentic: number | null;
  costPerTask: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  blendedPrice: number | null;
  outputSpeed: number | null;
  latency: number | null;
  /** 扩展数据：只有 AA 完整跑完 9 项评测的模型才有 */
  dimensions?: ModelViewDimensions | null;
}

export interface ModelCatalog {
  models: ModelPoint[];
  syncedAt: string;
  refreshIntervalMs: number;
  indexVersion: number | null;
  source: {
    mode: SourceMode;
    provider: "Artificial Analysis";
    tier: string;
    url: string;
    notice?: string;
    noticeKey?: SourceNoticeKey;
    noticeStatus?: number;
  };
}

export function isChartableModel(
  model: ModelPoint,
): model is ModelPoint & { intelligence: number; costPerTask: number } {
  return (
    typeof model.intelligence === "number" &&
    Number.isFinite(model.intelligence) &&
    typeof model.costPerTask === "number" &&
    Number.isFinite(model.costPerTask) &&
    model.costPerTask > 0
  );
}
