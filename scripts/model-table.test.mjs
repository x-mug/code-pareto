import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import { ModelTable } from "../src/components/model-table.tsx";

const model = (id, name, intelligence, costPerTask, extra = {}) => ({
  id, slug: id, name, creator: "Vendor", intelligence, costPerTask,
  outputSpeed: null, ...extra,
});

describe("full model table", () => {
  it("includes missing cost and compares ranks on the same scored models", () => {
    const viewed = [
      model("a", "Unpriced", 40, null),
      model("b", "Priced", 30, 1),
      model("c", "View score only", 99, null),
      model("d", "Stale", 65, 2, { aaStale: true }),
    ];
    const official = [
      model("a", "Unpriced", 30, null),
      model("b", "Priced", 60, 1),
      model("c", "View score only", null, null),
      model("d", "Stale", 70, 2, { aaStale: true }),
    ];
    const html = renderToStaticMarkup(createElement(ModelTable, {
      models: viewed, officialModels: official, kneeIds: [], selectedId: null, onSelect: () => {},
    }));
    const doc = new JSDOM(html).window.document;
    const rows = Array.from(doc.querySelectorAll(".model-table__row"));
    const cells = (name) => Array.from(rows.find((row) => row.querySelector("strong").textContent === name).children, (cell) => cell.textContent.trim());
    const unpriced = cells("Unpriced");
    const priced = cells("Priced");
    expect(rows).toHaveLength(4);
    expect([unpriced[0], unpriced[2], unpriced[3], unpriced[5], unpriced[7]]).toEqual(["1", "40.0", "—", "—", "+1"]);
    expect([priced[0], priced[7]]).toEqual(["2", "-1"]);
    expect(cells("View score only")[0]).toBe("—");
    expect(cells("Stale")[0]).toBe("—");
    expect(rows.find((row) => row.querySelector("strong").textContent === "Stale").querySelector(".model-table__stale")).not.toBeNull();
  });
});
