import { describe, expect, it } from "vitest";

import { isChartableModel, type ModelPoint } from "@/lib/models";
import { hasOutputSpeed } from "@/lib/speed-logic";
import { applyView, DEFAULT_CUSTOM_WEIGHTS } from "@/lib/view-logic";

const model: ModelPoint = {
  id: "aa-model-1",
  slug: "aa-model-1",
  name: "New model",
  creator: "Example",
  creatorId: null,
  releaseDate: null,
  reasoning: true,
  intelligence: 34.6,
  coding: null,
  agentic: null,
  costPerTask: null,
  inputPrice: null,
  outputPrice: null,
  blendedPrice: null,
  outputSpeed: null,
  latency: null,
  dimensions: {
    pillars: { coding: 34.41, akw: 47.32, science: 25.93, reasoning: 32.7, knowledge: 57 },
    pillarCosts: null,
    openWeights: false,
  },
};

describe("applyView with incomplete model data", () => {
  it("preserves a measured coding score without inventing a cost", () => {
    const [result] = applyView([model], "coding", DEFAULT_CUSTOM_WEIGHTS);
    expect(result.intelligence).toBeCloseTo(34.41);
    expect(result.costPerTask).toBeNull();
    expect(isChartableModel(result)).toBe(false);
  });

  it("calculates a weighted score even when no pillar costs are known", () => {
    const [result] = applyView([model], "codingEngineering", DEFAULT_CUSTOM_WEIGHTS);
    expect(result.intelligence).toBeCloseTo(34.41 * 0.6 + 47.32 * 0.4);
    expect(result.costPerTask).toBeNull();
  });

  it("retains the existing calculation when all data is present", () => {
    const complete = {
      ...model,
      dimensions: {
        ...model.dimensions!,
        pillarCosts: { coding: 2, akw: 3, science: 4, reasoning: 5, knowledge: 6 },
      },
    };
    const [result] = applyView([complete], "codingEngineering", DEFAULT_CUSTOM_WEIGHTS);
    expect(result.intelligence).toBeCloseTo(34.41 * 0.6 + 47.32 * 0.4);
    expect(result.costPerTask).toBeCloseTo(2 * 0.6 + 3 * 0.4);
    expect(isChartableModel(result)).toBe(true);
  });

  it("keeps the official intelligence view unchanged", () => {
    expect(applyView([model], "intelligence", DEFAULT_CUSTOM_WEIGHTS)).toEqual([model]);
  });

  it("does not put a retained stale observation into current charts", () => {
    const observed = { ...model, costPerTask: 1, outputSpeed: 50 };
    expect(isChartableModel(observed)).toBe(true);
    expect(hasOutputSpeed(observed)).toBe(true);
    const stale = { ...observed, aaStale: true };
    expect(isChartableModel(stale)).toBe(false);
    expect(hasOutputSpeed(stale)).toBe(false);
  });
});
