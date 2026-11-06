import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { RecentModelUpdates } from "../src/components/recent-model-updates.tsx";
import { translate } from "../src/lib/i18n.ts";

const model = { id: "available-model", name: "Available Model", creator: "Example" };
const t = (key, params) => translate("zh-CN", key, params);

function event(modelId, name) {
  return {
    modelId,
    name,
    creator: "Example",
    kind: "added",
    observedAt: "2026-01-01T00:00:00Z",
    changes: [{ field: "intelligence", before: null, after: 42 }],
  };
}

function render(events) {
  const html = renderToStaticMarkup(createElement(RecentModelUpdates, {
    events,
    models: [model],
    locale: "zh-CN",
    t,
    onSelect: () => {},
  }));
  return new JSDOM(html).window.document;
}

describe("recent model updates", () => {
  it("makes the whole available record a button but leaves missing models unselectable", () => {
    const doc = render([event(model.id, "Available model"), event("missing-model", "Missing model")]);
    const rows = doc.querySelectorAll(".recent-updates__groups-viewport .recent-updates__item");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("button")?.textContent).toContain("Example");
    expect(rows[0].querySelector("button")?.textContent).toContain("42.0");
    expect(rows[1].querySelector("button")).toBeNull();
    expect(rows[1].textContent).toContain("Missing model");
    const measurement = doc.querySelector(".recent-updates__measure");
    expect(measurement?.getAttribute("aria-hidden")).toBe("true");
    expect(measurement?.hasAttribute("inert")).toBe(true);
  });

  it("shows the expand-all arrow only when a group has more than three records", () => {
    const events = [0, 1, 2, 3].map((i) => event("model-" + i, "Model " + i));
    expect(render(events.slice(0, 3)).querySelector(".recent-updates__more")).toBeNull();
    const doc = render(events);
    expect(doc.querySelectorAll(".recent-updates__groups-viewport .recent-updates__item")).toHaveLength(3);
    expect(doc.querySelector(".recent-updates__more")?.getAttribute("aria-label")).toBe("展开全部");
  });
});
