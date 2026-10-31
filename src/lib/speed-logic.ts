import type { ModelPoint } from "@/lib/models";

/** 图表横轴语义：cost 按每任务成本，speed 按输出速度 */
export type ChartAxisKey = "cost" | "speed";

export type SpeedChartableModel = ModelPoint & {
  intelligence: number;
  outputSpeed: number;
};

export interface SpeedKneeRecommendation extends SpeedChartableModel {
  kneeScore: number;
  idealDistance: number;
}

/** 能力有限且输出速度有限为正的模型才能上速度图 */
export function hasOutputSpeed(model: ModelPoint): model is SpeedChartableModel {
  return (
    typeof model.intelligence === "number" &&
    Number.isFinite(model.intelligence) &&
    typeof model.outputSpeed === "number" &&
    Number.isFinite(model.outputSpeed) &&
    model.outputSpeed > 0
  );
}

export function speedChartableModels(
  models: ModelPoint[],
): SpeedChartableModel[] {
  return models.filter(hasOutputSpeed);
}

export function getSpeedParetoFrontier(
  models: ModelPoint[],
): SpeedChartableModel[] {
  const sorted = speedChartableModels(models).sort(
    (a, b) => b.outputSpeed - a.outputSpeed || b.intelligence - a.intelligence,
  );

  let bestScore = Number.NEGATIVE_INFINITY;

  return sorted.filter((model) => {
    if (model.intelligence <= bestScore) return false;
    bestScore = model.intelligence;
    return true;
  });
}

const KNEE_TIE_TOLERANCE = 1e-12;

/** 归一化分母的退化判据，速度或分数挤成一个点时按 0 处理 */
const KNEE_RANGE_EPSILON = 1e-12;

/** 归一化比值，分母退化或结果溢出时返回 0，保证排序里没有 NaN 和 Infinity */
function safeNormalized(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (Math.abs(denominator) < KNEE_RANGE_EPSILON) return 0;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : 0;
}

function scoreSpeedKneeFrontier(
  frontier: SpeedChartableModel[],
): SpeedKneeRecommendation[] {
  if (frontier.length === 0) return [];
  if (frontier.length === 1) {
    return [
      {
        ...frontier[0],
        kneeScore: 0,
        idealDistance: 0,
      },
    ];
  }

  const fastest = frontier[0];
  const slowest = frontier[frontier.length - 1];
  const logFastestSpeed = Math.log10(fastest.outputSpeed);
  const logSpeedRange = logFastestSpeed - Math.log10(slowest.outputSpeed);
  const scoreRange = slowest.intelligence - fastest.intelligence;

  return frontier
    .map((model) => {
      // 0 表示最快或最低分的那一端，1 表示最慢或最高分的那一端
      const normalizedSpeed = safeNormalized(
        logFastestSpeed - Math.log10(model.outputSpeed),
        logSpeedRange,
      );
      const normalizedScore = safeNormalized(
        model.intelligence - fastest.intelligence,
        scoreRange,
      );

      return {
        ...model,
        // 与成本膝点镜像：离线越远越靠膝点
        kneeScore: normalizedScore - normalizedSpeed,
        idealDistance: Math.hypot(normalizedSpeed, 1 - normalizedScore),
      };
    })
    .sort((a, b) => {
      const kneeDelta = b.kneeScore - a.kneeScore;
      if (Math.abs(kneeDelta) > KNEE_TIE_TOLERANCE) return kneeDelta;

      const idealDelta = a.idealDistance - b.idealDistance;
      if (Math.abs(idealDelta) > KNEE_TIE_TOLERANCE) return idealDelta;

      return b.outputSpeed - a.outputSpeed;
    });
}

export function getSpeedKneeRecommendations(
  models: ModelPoint[],
  limit = 5,
): SpeedKneeRecommendation[] {
  const frontier = getSpeedParetoFrontier(speedChartableModels(models));
  const normalizedLimit = Math.max(0, Math.floor(limit));
  return scoreSpeedKneeFrontier(frontier).slice(0, normalizedLimit);
}

export function countSpeedChartable(models: ModelPoint[]): number {
  return speedChartableModels(models).length;
}
