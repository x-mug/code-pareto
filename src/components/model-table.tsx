"use client";

import { useMemo, useState } from "react";

import { useLocale } from "@/lib/i18n";
import type { ModelPoint } from "@/lib/models";

type SortKey =
  | "rank"
  | "name"
  | "score"
  | "cost"
  | "speed"
  | "value"
  | "aaIndex"
  | "rankDelta";

type SortDirection = "asc" | "desc";

interface ModelTableProps {
  /** 已按当前视角（及筛选）转换后的列表 */
  models: ModelPoint[];
  /** 原始 catalog.models，用于取 AA 综合 v5 与排名变化 */
  officialModels: ModelPoint[];
  kneeIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface ModelTableRow {
  id: string;
  name: string;
  creator: string;
  rank: number | null;
  score: number | null;
  cost: number | null;
  speed: number | null;
  value: number | null;
  aaIndex: number | null;
  rankDelta: number | null;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 与 model-explorer 内部保持一致的金额格式 */
function formatCost(value: number | null): string {
  if (value === null) return "—";
  if (value < 0.1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(value >= 100 ? 0 : 1);
}

/** 输出速度保留 1 位小数，表格内不显示单位后缀 */
function formatSpeed(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(1);
}

function formatPerDollar(value: number | null): string {
  if (value === null) return "—";
  if (value >= 100) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

/** 同分按名称排序，保证视角排名与官方排名在同一口径下可比 */
function buildRankMap(
  models: ModelPoint[],
  scoreOf: (model: ModelPoint) => number | null,
): Map<string, number> {
  const ranked = models
    .map((model) => ({ model, score: scoreOf(model) }))
    .filter(
      (entry): entry is { model: ModelPoint; score: number } =>
        isFiniteNumber(entry.score),
    )
    .sort(
      (a, b) =>
        b.score - a.score || a.model.name.localeCompare(b.model.name),
    );

  const ranks = new Map<string, number>();
  ranked.forEach((entry, index) => ranks.set(entry.model.id, index + 1));
  return ranks;
}

export function ModelTable({
  models,
  officialModels,
  kneeIds,
  selectedId,
  onSelect,
}: ModelTableProps) {
  const { locale, t } = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const rows = useMemo(() => {
    const officialById = new Map(
      officialModels.map((model) => [model.id, model]),
    );
    const viewRanks = buildRankMap(models, (model) => model.intelligence);
    const officialRanks = buildRankMap(
      models,
      (model) => officialById.get(model.id)?.intelligence ?? null,
    );

    return models.map((model): ModelTableRow => {
      const official = officialById.get(model.id);
      const rank = viewRanks.get(model.id) ?? null;
      const officialRank = officialRanks.get(model.id) ?? null;
      const score = isFiniteNumber(model.intelligence)
        ? model.intelligence
        : null;
      const cost = isFiniteNumber(model.costPerTask) ? model.costPerTask : null;
      const speed = isFiniteNumber(model.outputSpeed) ? model.outputSpeed : null;

      return {
        id: model.id,
        name: model.name,
        creator: model.creator,
        rank,
        score,
        cost,
        speed,
        value: score !== null && cost !== null && cost > 0 ? score / cost : null,
        aaIndex: isFiniteNumber(official?.intelligence)
          ? official.intelligence
          : null,
        rankDelta:
          rank !== null && officialRank !== null ? officialRank - rank : null,
      };
    });
  }, [models, officialModels]);

  const kneeIdSet = useMemo(() => new Set(kneeIds), [kneeIds]);

  const sortedRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const byName = (a: ModelTableRow, b: ModelTableRow) =>
      a.name.localeCompare(b.name, locale);

    return [...rows].sort((a, b) => {
      if (sortKey === "name") return byName(a, b) * direction;

      const left = a[sortKey];
      const right = b[sortKey];
      if (left === null && right === null) return byName(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      return left === right ? byName(a, b) : (left - right) * direction;
    });
  }, [locale, rows, sortDirection, sortKey]);

  const handleSort = (nextKey: SortKey) => {
    if (nextKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "rank" || nextKey === "name" ? "asc" : "desc");
  };

  const columns: Array<{ key: SortKey; label: string; numeric: boolean }> = [
    { key: "rank", label: t("table.rank"), numeric: true },
    { key: "name", label: t("table.model"), numeric: false },
    { key: "score", label: t("table.score"), numeric: true },
    { key: "cost", label: t("table.cost"), numeric: true },
    { key: "speed", label: t("table.speed"), numeric: true },
    { key: "value", label: t("table.value"), numeric: true },
    { key: "aaIndex", label: t("table.aaIndex"), numeric: true },
    { key: "rankDelta", label: t("table.rankDelta"), numeric: true },
  ];

  return (
    <section className="model-table" aria-labelledby="model-table-title">
      <div className="model-table__heading">
        <div>
          <h3 id="model-table-title">{t("table.title")}</h3>
          <p className="model-table__subtitle">{t("table.subtitle")}</p>
        </div>
        <span className="model-table__count">{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <p className="model-table__empty">{t("table.empty")}</p>
      ) : (
        <div className="model-table__scroll">
          <table>
            <thead>
              <tr>
                {columns.map((column) => {
                  const isActive = column.key === sortKey;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={column.numeric ? "is-numeric" : undefined}
                      aria-sort={
                        isActive
                          ? sortDirection === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        type="button"
                        className="model-table__sort"
                        onClick={() => handleSort(column.key)}
                      >
                        <span>{column.label}</span>
                        {isActive ? (
                          <span
                            className="model-table__sort-mark"
                            aria-hidden="true"
                          >
                            {sortDirection === "asc" ? "↑" : "↓"}
                          </span>
                        ) : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isSelected = row.id === selectedId;
                const isKnee = kneeIdSet.has(row.id);
                const delta = row.rankDelta;

                return (
                  <tr
                    key={row.id}
                    tabIndex={0}
                    aria-current={isSelected ? "true" : undefined}
                    className={`model-table__row${isSelected ? " is-selected" : ""}${isKnee ? " is-knee" : ""}`}
                    onClick={() => onSelect(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(row.id);
                      }
                    }}
                  >
                    <td className="model-table__rank">{row.rank ?? "—"}</td>
                    <td className="model-table__model">
                      <span className="model-table__model-main">
                        <strong>{row.name}</strong>
                        <span className="model-table__creator">
                          {row.creator}
                        </span>
                      </span>
                    </td>
                    <td className="model-table__num">{formatNumber(row.score)}</td>
                    <td className="model-table__num">{formatCost(row.cost)}</td>
                    <td className="model-table__num">
                      {formatSpeed(row.speed)}
                    </td>
                    <td className="model-table__num">
                      {formatPerDollar(row.value)}
                    </td>
                    <td className="model-table__num">
                      {formatNumber(row.aaIndex)}
                    </td>
                    <td
                      className={`model-table__num${
                        delta === null
                          ? ""
                          : delta > 0
                            ? " delta-positive"
                            : delta < 0
                              ? " delta-negative"
                              : ""
                      }`}
                    >
                      {formatDelta(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
