import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";

export const MAX_MODEL_UPDATE_EVENTS = 500;

const FIELDS = ["intelligence", "costPerTask", "inputPrice", "outputPrice"];
const FIELD_SET = new Set(FIELDS);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function timestamp(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("变更记录时间必须是有效的 ISO 时间字符串");
  }
  return Date.parse(value);
}

function numberOrNull(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(label + " 必须是有限数字或 null");
  }
  return value;
}

function indexModels(catalog, label) {
  if (!catalog || !Array.isArray(catalog.models)) {
    throw new Error(label + "缺少 models 数组");
  }
  const byId = new Map();
  for (const model of catalog.models) {
    if (!model || typeof model.id !== "string" || !model.id ||
        typeof model.name !== "string" || !model.name ||
        typeof model.creator !== "string" || !model.creator) {
      throw new Error(label + "包含无效的模型 id、名称或厂商");
    }
    if (byId.has(model.id)) throw new Error(label + "包含重复的模型 id: " + model.id);
    const metrics = Object.fromEntries(
      FIELDS.map((field) => [field, numberOrNull(model[field], label + "." + model.id + "." + field)]),
    );
    byId.set(model.id, { ...model, ...metrics });
  }
  return byId;
}

function validateEvents(updates) {
  if (!updates || !Array.isArray(updates.events)) throw new Error("变更记录缺少 events 数组");
  for (const event of updates.events) {
    if (!event || typeof event.modelId !== "string" || !event.modelId ||
        typeof event.name !== "string" || !event.name ||
        typeof event.creator !== "string" || !event.creator ||
        (event.kind !== "added" && event.kind !== "updated") || !Array.isArray(event.changes)) {
      throw new Error("变更记录包含无效事件");
    }
    timestamp(event.observedAt);
    const seenFields = new Set();
    for (const change of event.changes) {
      if (!change || !FIELD_SET.has(change.field) || seenFields.has(change.field) ||
          !("before" in change) || !("after" in change) ||
          change.before === undefined || change.after === undefined) {
        throw new Error("变更记录包含无效字段");
      }
      seenFields.add(change.field);
      numberOrNull(change.before, "变更前数值");
      numberOrNull(change.after, "变更后数值");
    }
  }
}

function comparisonValue(field, value) {
  if (value === null) return null;
  const digits = field === "intelligence" ? 1 :
    field === "costPerTask" ? (value < 0.1 ? 3 : 2) : 4;
  return Number(value.toFixed(digits));
}

function eventKey(event) {
  return JSON.stringify([
    event.modelId,
    event.kind,
    timestamp(event.observedAt),
    event.changes.map(({ field, before, after }) => [field, before, after]),
  ]);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildModelUpdates(previousCatalog, nextCatalog, previousUpdates, observedAt, limit = MAX_MODEL_UPDATE_EVENTS) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("变更记录上限必须是非负整数");
  const observationTime = new Date(timestamp(observedAt)).toISOString();
  validateEvents(previousUpdates);
  const nextModels = indexModels(nextCatalog, "新目录");
  if (previousCatalog === null) return previousUpdates;
  const previousModels = indexModels(previousCatalog, "旧目录");
  const newEvents = [];
  for (const model of nextModels.values()) {
    const previous = previousModels.get(model.id);
    const changes = [];
    for (const field of FIELDS) {
      const before = previous ? previous[field] : null;
      const after = model[field];
      if (previous ? comparisonValue(field, before) !== comparisonValue(field, after) : after !== null) {
        changes.push({ field, before, after });
      }
    }
    if (!previous || changes.length > 0) {
      newEvents.push({
        modelId: model.id,
        name: model.name,
        creator: model.creator,
        kind: previous ? "updated" : "added",
        observedAt: observationTime,
        changes,
      });
    }
  }
  if (newEvents.length === 0) return previousUpdates;
  const unique = new Map();
  for (const event of [...previousUpdates.events, ...newEvents]) {
    const key = eventKey(event);
    if (!unique.has(key)) unique.set(key, event);
  }
  const events = [...unique.values()].sort((left, right) =>
    timestamp(right.observedAt) - timestamp(left.observedAt) ||
    compareText(left.modelId, right.modelId) ||
    compareText(eventKey(left), eventKey(right)),
  );
  return { events: events.slice(0, limit) };
}

export async function persistSnapshotFiles(files, io = fs) {
  const staged = [];
  const installed = [];
  const preserveBackups = new Set();
  try {
    for (const file of files) {
      const suffix = "." + randomUUID();
      const entry = { ...file, temporary: file.path + suffix + ".tmp", backup: file.path + suffix + ".bak" };
      staged.push(entry);
      await io.writeFile(entry.temporary, entry.content, { encoding: "utf8", flag: "wx" });
      if (entry.previous !== null) {
        await io.writeFile(entry.backup, entry.previous, { encoding: "utf8", flag: "wx" });
      }
    }
    for (const entry of staged) {
      await io.rename(entry.temporary, entry.path);
      installed.push(entry);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const entry of installed.reverse()) {
      try {
        if (entry.previous === null) await io.unlink(entry.path);
        else await io.rename(entry.backup, entry.path);
      } catch (restoreError) {
        if (entry.previous !== null) preserveBackups.add(entry.backup);
        restoreErrors.push(restoreError);
      }
    }
    if (restoreErrors.length > 0) {
      throw new AggregateError([error, ...restoreErrors], "写入失败且恢复失败，备份位置: " + [...preserveBackups].join(", "));
    }
    throw error;
  } finally {
    for (const entry of staged) {
      await io.unlink(entry.temporary).catch(() => {});
      if (!preserveBackups.has(entry.backup)) await io.unlink(entry.backup).catch(() => {});
    }
  }
}
