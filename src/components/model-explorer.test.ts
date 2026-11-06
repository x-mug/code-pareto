import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelExplorer } from "@/components/model-explorer";
import type { ModelCatalog, ModelPoint } from "@/lib/models";

describe("model roster", () => {
  it("renders the roster even when no model has a task cost", () => {
    const unpriced: ModelPoint = {
      creatorId: null, releaseDate: null, reasoning: false,
      coding: null, agentic: null, inputPrice: null, outputPrice: null, blendedPrice: null, latency: null,
      id: "unpriced-example",
      slug: "unpriced-example",
      name: "Unpriced Example",
      creator: "Example",
      intelligence: 42,
      costPerTask: null,
      outputSpeed: null,
      aaStale: false,
    };
    const html = renderToStaticMarkup(createElement(ModelExplorer, {
      initialCatalog: {
        models: [unpriced], syncedAt: "2026-01-01T00:00:00Z", refreshIntervalMs: 28800000, indexVersion: 5,
        source: { provider: "Artificial Analysis", url: "https://artificialanalysis.ai/", tier: "free", mode: "live" },
      } satisfies ModelCatalog,
    }));

    expect(html).toContain('class="model-table__row');
    expect(html).toContain("Unpriced Example");
    expect(html).toContain('class="model-table__search"');
    expect(html).toContain("42.0");
  });
});
