"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

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
  const groupsViewportRef = useRef<HTMLDivElement>(null);
  const animateGroupsRef = useRef(false);

  const changeView = (nextView: UpdatesView) => {
    const viewport = groupsViewportRef.current;
    if (viewport && (view === "full") !== (nextView === "full")) {
      viewport.style.height = viewport.getBoundingClientRect().height + "px";
      viewport.classList.add("is-animating");
      viewport.getBoundingClientRect();
      animateGroupsRef.current = true;
    }
    setView(nextView);
  };

  useLayoutEffect(() => {
    const viewport = groupsViewportRef.current;
    if (!viewport || !animateGroupsRef.current) return;
    animateGroupsRef.current = false;

    const contentHeight = viewport.firstElementChild?.getBoundingClientRect().height ?? 0;
    const targetHeight = view === "full" ? Math.min(contentHeight, window.innerHeight * 0.6) : contentHeight;
    const startHeight = viewport.getBoundingClientRect().height;
    const finish = () => {
      viewport.style.height = "";
      viewport.classList.remove("is-animating");
    };
    if (Math.abs(targetHeight - startHeight) < 0.5 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== viewport || event.propertyName !== "height") return;
      window.clearTimeout(fallback);
      viewport.removeEventListener("transitionend", onTransitionEnd);
      finish();
    };
    const fallback = window.setTimeout(() => {
      viewport.removeEventListener("transitionend", onTransitionEnd);
      finish();
    }, 400);
    viewport.addEventListener("transitionend", onTransitionEnd);
    viewport.style.height = targetHeight + "px";

    return () => {
      window.clearTimeout(fallback);
      viewport.removeEventListener("transitionend", onTransitionEnd);
    };
  }, [view]);

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
          <h3 id="recent-updates-title">
            <button
              type="button"
              className="recent-updates__title-toggle"
              aria-expanded={isOpen}
              aria-controls="recent-updates-content"
              onClick={() => changeView(isOpen ? "collapsed" : "partial")}
            >
              {t("updates.title")}
              <svg
                className="recent-updates__chevron"
                viewBox="0 0 12 12"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
          </h3>
          {!isOpen && (
            <p className="recent-updates__summary">
              {t("updates.summary", { added: added.length, changed: changed.length })}
            </p>
          )}
        </div>
      </div>
      <div
        id="recent-updates-content"
        className="recent-updates__content"
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className="recent-updates__content-inner">
          <p className="recent-updates__description">{t("updates.description")}</p>
          <div className="recent-updates__groups-viewport" ref={groupsViewportRef}>
            <div className="recent-updates__groups" id="recent-updates-groups">
              {renderGroup(t("updates.added"), added)}
              {renderGroup(t("updates.changed"), changed)}
            </div>
          </div>
          {hasMore && (
            <div className="recent-updates__actions">
              <button
                type="button"
                className="recent-updates__more"
                aria-expanded={view === "full"}
                aria-controls="recent-updates-groups"
                onClick={() => changeView(view === "full" ? "partial" : "full")}
              >
                {t(view === "full" ? "updates.partial" : "updates.more")}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
