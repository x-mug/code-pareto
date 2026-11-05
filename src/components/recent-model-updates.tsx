"use client";

import { useMemo, useState } from "react";

import type { Locale, TranslationKey, Translator } from "@/lib/i18n";
import type { ModelPoint } from "@/lib/models";

type UpdateField = "intelligence" | "costPerTask" | "inputPrice" | "outputPrice";

export interface RecentModelUpdate {
  modelId: string;
  name: string;
  creator: string;
  kind: "added" | "updated";
  observedAt: string;
  changes: { field: UpdateField; before: number | null; after: number | null }[];
}

export interface RecentModelUpdateData {
  events: RecentModelUpdate[];
}

interface RecentModelUpdatesProps {
  events: RecentModelUpdate[];
  models: ModelPoint[];
  locale: Locale;
  t: Translator;
  onSelect: (id: string) => void;
}

const VISIBLE_BY_DEFAULT = 3;

const FIELD_LABELS: Record<UpdateField, TranslationKey> = {
  intelligence: "updates.score",
  costPerTask: "updates.cost",
  inputPrice: "updates.inputPrice",
  outputPrice: "updates.outputPrice",
};

function formatObservedAt(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatChangeValue(field: UpdateField, value: number | null, locale: Locale): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (field === "intelligence") return value.toFixed(1);
  if (field === "costPerTask") return "$" + value.toFixed(value < 0.1 ? 3 : 2);
  return "$" + new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
}

function updatesByKind(events: RecentModelUpdate[], kind: RecentModelUpdate["kind"]) {
  const seen = new Set<string>();
  return events
    .filter((event) => event.kind === kind)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
    .filter((event) => {
      if (seen.has(event.modelId)) return false;
      seen.add(event.modelId);
      return true;
    });
}

type UpdatesView = "collapsed" | "partial" | "full";

export function RecentModelUpdates({ events, models, locale, t, onSelect }: RecentModelUpdatesProps) {
  const [view, setView] = useState<UpdatesView>("collapsed");
  const availableIds = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const added = useMemo(() => updatesByKind(events, "added"), [events]);
  const changed = useMemo(() => updatesByKind(events, "updated"), [events]);
  const limit = view === "full" ? undefined : VISIBLE_BY_DEFAULT;
  const hasMore =
    added.length > VISIBLE_BY_DEFAULT || changed.length > VISIBLE_BY_DEFAULT;
  const isOpen = view !== "collapsed";

  const renderGroup = (label: string, items: RecentModelUpdate[]) => (
    <div className="recent-updates__group">
      <h4>{label}</h4>
      {items.length === 0 ? (
        <p className="recent-updates__empty">{t("updates.empty")}</p>
      ) : (
        <ol className="recent-updates__list">
          {items.slice(0, limit).map((event) => (
            <li className="recent-updates__item" key={event.modelId + event.observedAt}>
              <div className="recent-updates__item-head">
                {availableIds.has(event.modelId) ? (
                  <button
                    type="button"
                    className="recent-updates__model"
                    aria-label={t("updates.select", { model: event.name })}
                    onClick={() => onSelect(event.modelId)}
                  >
                    {event.name}
                  </button>
                ) : (
                  <strong className="recent-updates__model-name">{event.name}</strong>
                )}
                <time dateTime={event.observedAt}>{formatObservedAt(event.observedAt, locale)}</time>
              </div>
              <div className="recent-updates__meta">{event.creator}</div>
              <div className="recent-updates__values">
                <span className="recent-updates__values-label">
                  {t(event.kind === "added" ? "updates.addedValues" : "updates.changedValues")}
                </span>
                {event.changes.length === 0 ? (
                  <span>{t("updates.noDetails")}</span>
                ) : (
                  event.changes.map((change) => (
                    <span className="recent-updates__value" key={change.field}>
                      {t(FIELD_LABELS[change.field])}{" "}
                      {event.kind === "updated"
                        ? formatChangeValue(change.field, change.before, locale) + " → "
                        : ""}
                      {formatChangeValue(change.field, change.after, locale)}
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  return (
    <section
      className={"recent-updates" + (isOpen ? " is-open" : "") + (view === "full" ? " is-full" : "")}
      aria-labelledby="recent-updates-title"
    >
      <div className="recent-updates__heading">
        <div className="recent-updates__heading-copy">
          <h3 id="recent-updates-title">{t("updates.title")}</h3>
          {!isOpen && (
            <p className="recent-updates__summary">
              {t("updates.summary", { added: added.length, changed: changed.length })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="recent-updates__toggle"
          aria-expanded={isOpen}
          aria-controls="recent-updates-content"
          onClick={() => setView(isOpen ? "collapsed" : "partial")}
        >
          {t(isOpen ? "updates.less" : "updates.expand")}
        </button>
      </div>
      <div id="recent-updates-content" hidden={!isOpen}>
        {isOpen && (
          <>
            <p className="recent-updates__description">{t("updates.description")}</p>
            <div className="recent-updates__groups" id="recent-updates-groups">
              {renderGroup(t("updates.added"), added)}
              {renderGroup(t("updates.changed"), changed)}
            </div>
            {hasMore && (
              <div className="recent-updates__actions">
                <button
                  type="button"
                  className="recent-updates__more"
                  aria-expanded={view === "full"}
                  aria-controls="recent-updates-groups"
                  onClick={() => setView(view === "full" ? "partial" : "full")}
                >
                  {t(view === "full" ? "updates.partial" : "updates.more")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
