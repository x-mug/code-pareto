import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelExplorer } from "@/components/model-explorer";
import catalogData from "@/data/catalog.json";
import type { ModelCatalog, ModelPoint } from "@/lib/models";

describe("model roster", () => {
  it("renders the roster even when no model has a task cost", () => {
    const catalog = catalogData as ModelCatalog;
    const unpriced: ModelPoint = {
      ...catalog.models[0],
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
      initialCatalog: { ...catalog, models: [unpriced] },
    }));

    expect(html).toContain('class="model-table__row');
    expect(html).toContain("Unpriced Example");
    expect(html).toContain('class="model-table__search"');
    expect(html).toContain("42.0");
  });
});
