import { describe, expect, it } from "vitest";
import { buildModelUpdates, MAX_MODEL_UPDATE_EVENTS, persistSnapshotFiles } from "./model-updates.mjs";

const time = "2026-11-04T19:52:54Z";
const later = "2026-11-05T06:00:00Z";
const catalog = (...models) => ({ models });
const model = (id, fields = {}) => ({
  id,
  name: "Model " + id,
  creator: "Vendor",
  intelligence: null,
  costPerTask: null,
  inputPrice: null,
  outputPrice: null,
  ...fields,
});

function memoryFs(initial, failure = {}) {
  const files = new Map(Object.entries(initial));
  const failOnce = { ...failure };
  return {
    files,
    async writeFile(path, content) {
      if (failOnce.write && path.includes(failOnce.write)) {
        delete failOnce.write;
        throw new Error("write failed");
      }
      if (files.has(path)) throw new Error("file exists");
      files.set(path, content);
    },
    async rename(from, to) {
      if (failOnce.rename === to && from.endsWith(".tmp")) {
        delete failOnce.rename;
        throw new Error("rename failed");
      }
      if (!files.has(from)) throw new Error("missing source");
      files.set(to, files.get(from));
      files.delete(from);
    },
    async unlink(path) {
      if (!files.delete(path)) throw new Error("missing file");
    },
  };
}

describe("model update events", () => {
  it("records new ids with only their observed non-null metrics", () => {
    const next = model("new", { intelligence: 42.3, costPerTask: 0.03, inputPrice: 0, outputPrice: null });
    const result = buildModelUpdates(catalog(), catalog(next), { events: [] }, time);
    expect(result.events).toEqual([{
      modelId: "new", name: "Model new", creator: "Vendor", kind: "added",
      observedAt: "2026-11-04T19:52:54.000Z",
      changes: [
        { field: "intelligence", before: null, after: 42.3 },
        { field: "costPerTask", before: null, after: 0.03 },
        { field: "inputPrice", before: null, after: 0 },
      ],
    }]);
  });

  it("records meaningful changes for the same id in field order", () => {
    const before = model("a", { intelligence: 42.3, costPerTask: 0.12, inputPrice: 2, outputPrice: 4 });
    const after = model("a", { intelligence: 43.1, costPerTask: 0.15, inputPrice: 2.5, outputPrice: 4 });
    expect(buildModelUpdates(catalog(before), catalog(after), { events: [] }, time).events).toEqual([{
      modelId: "a", name: "Model a", creator: "Vendor", kind: "updated",
      observedAt: "2026-11-04T19:52:54.000Z",
      changes: [
        { field: "intelligence", before: 42.3, after: 43.1 },
        { field: "costPerTask", before: 0.12, after: 0.15 },
        { field: "inputPrice", before: 2, after: 2.5 },
      ],
    }]);
  });

  it("tracks null to zero, zero to null, and a missing field", () => {
    const before = model("a", { intelligence: null, costPerTask: 0, inputPrice: undefined, outputPrice: 1 });
    const after = model("a", { intelligence: 0, costPerTask: null, inputPrice: 0, outputPrice: null });
    expect(buildModelUpdates(catalog(before), catalog(after), { events: [] }, time).events[0].changes).toEqual([
      { field: "intelligence", before: null, after: 0 },
      { field: "costPerTask", before: 0, after: null },
      { field: "inputPrice", before: null, after: 0 },
      { field: "outputPrice", before: 1, after: null },
    ]);
  });

  it("ignores speed, latency and numeric noise below display precision", () => {
    const before = model("a", { intelligence: 45.11, costPerTask: 0.04322, inputPrice: 0.123441, outputPrice: 0.8, outputSpeed: 2, latency: 3 });
    const after = model("a", { intelligence: 45.13, costPerTask: 0.04324, inputPrice: 0.123439, outputPrice: 0.800000000001, outputSpeed: 99, latency: 30 });
    const updates = { events: [] };
    expect(buildModelUpdates(catalog(before), catalog(after), updates, time)).toBe(updates);
    expect(buildModelUpdates(catalog(model("a", { costPerTask: 0.0999 })), catalog(model("a", { costPerTask: 0.1001 })), updates, time)).toBe(updates);
  });

  it("detects changes crossing the displayed rounding threshold", () => {
    const before = model("a", { intelligence: 45.14, costPerTask: 0.123, inputPrice: 0.12341 });
    const after = model("a", { intelligence: 45.16, costPerTask: 0.126, inputPrice: 0.12346 });
    expect(buildModelUpdates(catalog(before), catalog(after), { events: [] }, time).events[0].changes).toEqual([
      { field: "intelligence", before: 45.14, after: 45.16 },
      { field: "costPerTask", before: 0.123, after: 0.126 },
      { field: "inputPrice", before: 0.12341, after: 0.12346 },
    ]);
  });

  it("keeps previous events when the old snapshot is unavailable or the new snapshot is empty", () => {
    const previousUpdates = buildModelUpdates(catalog(), catalog(model("old")), { events: [] }, time);
    expect(buildModelUpdates(null, catalog(model("new")), previousUpdates, later)).toBe(previousUpdates);
    expect(buildModelUpdates(catalog(model("old")), catalog(), previousUpdates, later)).toBe(previousUpdates);
    expect(buildModelUpdates(catalog(), catalog(model("new")), previousUpdates, later).events).toHaveLength(2);
  });

  it("preserves existing events without creating duplicates on repeat generation", () => {
    const before = catalog(model("a", { intelligence: 1 }));
    const after = catalog(model("a", { intelligence: 2 }));
    const first = buildModelUpdates(before, after, { events: [] }, time);
    expect(buildModelUpdates(before, after, first, time)).toEqual(first);
    expect(buildModelUpdates(after, after, first, later)).toBe(first);
  });

  it("sorts by observation time, then id, and retains the newest events", () => {
    const old = buildModelUpdates(catalog(), catalog(model("z")), { events: [] }, time);
    const newest = buildModelUpdates(catalog(), catalog(model("c"), model("a"), model("b")), old, later, 3);
    expect(newest.events.map(({ modelId }) => modelId)).toEqual(["a", "b", "c"]);
    expect(MAX_MODEL_UPDATE_EVENTS).toBe(500);
  });

  it("normalizes the true commit time to UTC without using release dates", () => {
    const result = buildModelUpdates(catalog(), catalog(model("a", { releaseDate: "2001-01-01" })), { events: [] }, "2026-11-05T08:00:00+08:00");
    expect(result.events[0].observedAt).toBe("2026-11-05T00:00:00.000Z");
  });

  it("rejects invalid input instead of replacing existing records", () => {
    expect(() => buildModelUpdates(catalog(), catalog(model("x"), model("x")), { events: [] }, time)).toThrow(/重复/);
    expect(() => buildModelUpdates(catalog(), catalog(model("x", { inputPrice: "bad" })), { events: [] }, time)).toThrow(/有限数字/);
    expect(() => buildModelUpdates(catalog(), catalog(), { events: [{ modelId: "x" }] }, time)).toThrow(/无效事件/);
    expect(() => buildModelUpdates(catalog(), catalog(), { events: [] }, "2026-11-05")).toThrow(/ISO/);
  });
});

describe("snapshot file persistence", () => {
  const changes = [
    { path: "updates", previous: "old updates", content: "new updates" },
    { path: "catalog", previous: "old catalog", content: "new catalog" },
  ];

  it("replaces both files only after preparing their temporary files", async () => {
    const io = memoryFs({ updates: "old updates", catalog: "old catalog" });
    await persistSnapshotFiles(changes, io);
    expect([...io.files.entries()].sort()).toEqual([["catalog", "new catalog"], ["updates", "new updates"]]);
  });

  it("keeps both files intact when preparing a file fails", async () => {
    const io = memoryFs({ updates: "old updates", catalog: "old catalog" }, { write: "catalog." });
    await expect(persistSnapshotFiles(changes, io)).rejects.toThrow("write failed");
    expect([...io.files.entries()].sort()).toEqual([["catalog", "old catalog"], ["updates", "old updates"]]);
  });

  it("restores the first file if installing the second fails", async () => {
    const io = memoryFs({ updates: "old updates", catalog: "old catalog" }, { rename: "catalog" });
    await expect(persistSnapshotFiles(changes, io)).rejects.toThrow("rename failed");
    expect([...io.files.entries()].sort()).toEqual([["catalog", "old catalog"], ["updates", "old updates"]]);
  });

  it("removes a newly created first file if installing the second fails", async () => {
    const io = memoryFs({ catalog: "old catalog" }, { rename: "catalog" });
    await expect(persistSnapshotFiles([{ ...changes[0], previous: null }, changes[1]], io)).rejects.toThrow("rename failed");
    expect([...io.files.entries()]).toEqual([["catalog", "old catalog"]]);
  });
});
