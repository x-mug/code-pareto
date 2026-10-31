import { describe, expect, it } from "vitest";

import { getParetoFrontier } from "@/lib/model-logic";
import {
  countSpeedChartable,
  getSpeedKneeRecommendations,
  getSpeedParetoFrontier,
  hasOutputSpeed,
  speedChartableModels,
} from "@/lib/speed-logic";
import type { ModelPoint } from "@/lib/models";

function model(
  id: string,
  intelligence: number | null,
  outputSpeed: number | null,
  costPerTask: number | null = 0.1,
): ModelPoint {
  return {
    id,
    slug: id,
    name: id,
    creator: "Test",
    creatorId: null,
    releaseDate: null,
    reasoning: false,
    intelligence,
    coding: null,
    agentic: null,
    costPerTask,
    inputPrice: null,
    outputPrice: null,
    blendedPrice: null,
    outputSpeed,
    latency: null,
  };
}

describe("hasOutputSpeed", () => {
  it("accepts finite intelligence with a positive finite speed", () => {
    const candidate = model("speedster", 40, 120);

    expect(hasOutputSpeed(candidate)).toBe(true);
    if (hasOutputSpeed(candidate)) {
      // 收窄之后可以直接当数字用
      expect(candidate.outputSpeed).toBe(120);
      expect(candidate.intelligence).toBe(40);
    }
  });

  it("rejects models missing intelligence or speed", () => {
    expect(hasOutputSpeed(model("no-speed", 40, null))).toBe(false);
    expect(hasOutputSpeed(model("no-score", null, 120))).toBe(false);
    expect(hasOutputSpeed(model("zero-speed", 40, 0))).toBe(false);
    expect(hasOutputSpeed(model("negative-speed", 40, -5))).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    const nanScore = { ...model("nan-score", 40, 120), intelligence: Number.NaN };
    const nanSpeed = { ...model("nan-speed", 40, 120), outputSpeed: Number.NaN };
    const infiniteSpeed = {
      ...model("infinite-speed", 40, 120),
      outputSpeed: Number.POSITIVE_INFINITY,
    };

    expect(hasOutputSpeed(nanScore)).toBe(false);
    expect(hasOutputSpeed(nanSpeed)).toBe(false);
    expect(hasOutputSpeed(infiniteSpeed)).toBe(false);
  });
});

describe("speedChartableModels", () => {
  it("keeps only models with a usable speed and preserves order", () => {
    const result = speedChartableModels([
      model("a", 40, 120),
      model("no-speed", 50, null),
      model("b", 30, 20),
    ]);

    expect(result.map((item) => item.id)).toEqual(["a", "b"]);
    // 类型上 speed 已经是非空数字，可以直接求和
    expect(result.reduce((total, item) => total + item.outputSpeed, 0)).toBe(140);
  });
});

describe("countSpeedChartable", () => {
  it("counts models that can be plotted on the speed axis", () => {
    expect(countSpeedChartable([])).toBe(0);
    expect(
      countSpeedChartable([
        model("a", 40, 120),
        model("no-speed", 50, null),
        model("b", 30, 20),
        model("zero-speed", 20, 0),
      ]),
    ).toBe(2);
  });
});

describe("getSpeedParetoFrontier", () => {
  it("keeps each new intelligence maximum as speed drops", () => {
    const result = getSpeedParetoFrontier([
      model("fastest", 20, 400),
      model("dominated", 18, 300),
      model("mid", 30, 200),
      model("also-dominated", 28, 100),
      model("slowest", 35, 50),
    ]);

    expect(result.map((item) => item.id)).toEqual(["fastest", "mid", "slowest"]);
  });

  it("keeps only the strongest model when speeds tie", () => {
    const result = getSpeedParetoFrontier([
      model("same-speed-weak", 20, 100),
      model("same-speed-strong", 30, 100),
    ]);

    expect(result.map((item) => item.id)).toEqual(["same-speed-strong"]);
  });

  it("drops models without speed before ranking", () => {
    const result = getSpeedParetoFrontier([
      model("chartable", 20, 100),
      model("unplottable-strong", 90, null),
    ]);

    expect(result.map((item) => item.id)).toEqual(["chartable"]);
    expect(getSpeedParetoFrontier([])).toEqual([]);
    expect(getSpeedParetoFrontier([model("no-speed", 50, null)])).toEqual([]);
  });

  it("differs from the cost frontier because the axes are mirrored", () => {
    const models = [
      model("fast-weak-cheap", 20, 400, 0.01),
      model("mid-fast-pricey", 25, 100, 3),
      model("slow-strong-cheap", 60, 20, 0.02),
    ];

    expect(getSpeedParetoFrontier(models).map((item) => item.id)).toEqual([
      "fast-weak-cheap",
      "mid-fast-pricey",
      "slow-strong-cheap",
    ]);
    // 同一批模型在价格轴上会把最贵的中速模型淘汰掉
    expect(getParetoFrontier(models).map((item) => item.id)).toEqual([
      "fast-weak-cheap",
      "slow-strong-cheap",
    ]);
  });
});

describe("getSpeedKneeRecommendations", () => {
  const kneeModels = [
    model("fastest", 10, 400),
    model("knee", 45, 300),
    model("dominated", 44, 250),
    model("later-frontier", 50, 100),
    model("slowest", 60, 20),
  ];

  it("ranks Pareto-frontier models by knee score and excludes dominated models", () => {
    const result = getSpeedKneeRecommendations(kneeModels, 3);

    expect(result.map((item) => item.id)).toEqual([
      "knee",
      "later-frontier",
      "fastest",
    ]);
    expect(result[0].kneeScore).toBeGreaterThan(result[1].kneeScore);
    expect(result.every((item) => item.id !== "dominated")).toBe(true);
  });

  it("puts both frontier endpoints at knee score zero and ideal distance one", () => {
    const result = getSpeedKneeRecommendations(kneeModels, 10);

    expect(result[0].id).toBe("knee");
    expect(result[0].kneeScore).toBeGreaterThan(0);

    const fastest = result.find((item) => item.id === "fastest");
    const slowest = result.find((item) => item.id === "slowest");

    expect(fastest?.kneeScore).toBeCloseTo(0, 12);
    expect(fastest?.idealDistance).toBeCloseTo(1, 12);
    expect(slowest?.kneeScore).toBeCloseTo(0, 12);
    expect(slowest?.idealDistance).toBeCloseTo(1, 12);
  });

  it("falls back to ideal distance and then speed when knee scores tie", () => {
    const result = getSpeedKneeRecommendations(
      [model("fastest", 10, 8), model("balanced", 35, 4), model("slowest", 60, 2)],
      10,
    );

    // 三点都在对角线上，膝点分相同，先比理想距离再比速度
    expect(result.map((item) => item.id)).toEqual([
      "balanced",
      "fastest",
      "slowest",
    ]);
  });

  it("defaults to five recommendations", () => {
    const models = Array.from({ length: 7 }, (_, index) =>
      model(`point-${index}`, 10 + index * 5, 700 / (index + 1)),
    );

    expect(getSpeedKneeRecommendations(models)).toHaveLength(5);
  });

  it("returns a zero-score recommendation for a single-model frontier", () => {
    const [result] = getSpeedKneeRecommendations([model("only", 40, 100)]);

    expect(result.id).toBe("only");
    expect(result.kneeScore).toBe(0);
    expect(result.idealDistance).toBe(0);
  });

  it("returns an empty list when nothing is plottable or the limit is zero", () => {
    expect(getSpeedKneeRecommendations([])).toEqual([]);
    expect(getSpeedKneeRecommendations([model("no-speed", 40, null)])).toEqual([]);
    expect(getSpeedKneeRecommendations(kneeModels, 0)).toEqual([]);
    expect(getSpeedKneeRecommendations(kneeModels, -3)).toEqual([]);
  });

  it("never leaks NaN into ordering when every speed ties", () => {
    const result = getSpeedKneeRecommendations([
      model("same-speed-weak", 20, 100),
      model("same-speed-strong", 60, 100),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("same-speed-strong");
    expect(result[0].kneeScore).toBe(0);
    expect(Number.isFinite(result[0].idealDistance)).toBe(true);
  });

  it("never leaks NaN into ordering when every score ties", () => {
    const result = getSpeedKneeRecommendations([
      model("fast-tie", 40, 400),
      model("mid-tie", 40, 200),
      model("slow-tie", 40, 100),
    ]);

    expect(result.map((item) => item.id)).toEqual(["fast-tie"]);
    expect(Number.isFinite(result[0].kneeScore)).toBe(true);
  });

  it("keeps knee scores finite and ordered on messy input", () => {
    const result = getSpeedKneeRecommendations(
      [
        model("a", 10, 100),
        model("a-twin", 10, 100),
        model("b", 20, 50),
        model("b-twin", 20, 50),
        model("c", 30, 25),
        model("no-speed", 99, null),
        model("no-score", null, 80),
      ],
      10,
    );

    // b 在膝点上，a 与 c 理想距离同为 1，按速度降序 a 在前
    expect(result.map((item) => item.id)).toEqual(["b", "a", "c"]);

    for (const item of result) {
      expect(Number.isFinite(item.kneeScore)).toBe(true);
      expect(Number.isFinite(item.idealDistance)).toBe(true);
      expect(item.kneeScore).toBeGreaterThanOrEqual(-1);
      expect(item.kneeScore).toBeLessThanOrEqual(1);
      expect(item.idealDistance).toBeGreaterThanOrEqual(0);
    }

    // 排序允许 1e-12 的并列容差，容差内改按理想距离排
    for (let index = 1; index < result.length; index += 1) {
      expect(result[index - 1].kneeScore).toBeGreaterThanOrEqual(
        result[index].kneeScore - 1e-9,
      );
    }
  });
});
