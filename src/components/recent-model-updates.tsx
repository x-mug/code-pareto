"use client";

import { motion } from "motion/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import useMeasure from "react-use-measure";

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

function formatObservedAt(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatter.format(date);
}

function formatChangeValue(field: UpdateField, value: number | null, formatter: Intl.NumberFormat): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (field === "intelligence") return value.toFixed(1);
  if (field === "costPerTask") return "$" + value.toFixed(value < 0.1 ? 3 : 2);
  return "$" + formatter.format(value);
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

function subscribeToViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function getViewportHeight() {
  return window.innerHeight;
}

function subscribeToReducedMotion(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function getReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type UpdatesView = "collapsed" | "partial" | "full";

export function RecentModelUpdates({ events, models, locale, t, onSelect }: RecentModelUpdatesProps) {
  const [view, setView] = useState<UpdatesView>("collapsed");
  const [groupsRef, groupsBounds] = useMeasure();
  const [partialRef, partialBounds] = useMeasure();
  const viewportHeight = useSyncExternalStore(subscribeToViewport, getViewportHeight, () => 0);
  const reduceMotion = useSyncExternalStore(subscribeToReducedMotion, getReducedMotion, () => false);
  const availableIds = useMemo(() => new Set(models.map((model) => model.id)), [models]);
  const added = useMemo(() => updatesByKind(events, "added"), [events]);
  const changed = useMemo(() => updatesByKind(events, "updated"), [events]);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }), [locale]);
  const limit = view === "full" ? undefined : VISIBLE_BY_DEFAULT;
  const hasMore = added.length > VISIBLE_BY_DEFAULT || changed.length > VISIBLE_BY_DEFAULT;
  const isOpen = view !== "collapsed";
  const isFull = view === "full";
  const partialHeight = partialBounds.height || 0;
  const fullHeight = viewportHeight > 0
    ? Math.max(partialHeight + Math.min(96, viewportHeight * 0.2), viewportHeight * 0.6)
    : partialHeight;
  const groupHeight = isFull
    ? groupsBounds.height > 0 && fullHeight > 0
      ? Math.min(groupsBounds.height, fullHeight)
      : "auto"
    : partialHeight || "auto";
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.26, ease: [0.22, 0.61, 0.36, 1] as [number, number, number, number] };

  const renderGroup = (label: string, items: RecentModelUpdate[], maxItems = limit, measuring = false) => (
    <div className="recent-updates__group">
      <h4>{label}</h4>
      {items.length === 0 ? (
        <p className="recent-updates__empty">{t("updates.empty")}</p>
      ) : (
        <ol className="recent-updates__list">
          {items.slice(0, maxItems).map((event) => {
            const content = (
              <>
                <span className="recent-updates__item-head">
                  <strong className="recent-updates__model-name">{event.name}</strong>
                  <time dateTime={event.observedAt}>{formatObservedAt(event.observedAt, dateFormatter)}</time>
                </span>
                <span className="recent-updates__meta">{event.creator}</span>
                <span className="recent-updates__values">
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
                          ? formatChangeValue(change.field, change.before, numberFormatter) + " → "
                          : ""}
                        {formatChangeValue(change.field, change.after, numberFormatter)}
                      </span>
                    ))
                  )}
                </span>
              </>
            );
            return (
              <li className="recent-updates__item" key={event.modelId + event.observedAt}>
                {availableIds.has(event.modelId) && !measuring ? (
                  <button
                    type="button"
                    className="recent-updates__item-button"
                    title={t("updates.select", { model: event.name })}
                    onClick={() => onSelect(event.modelId)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="recent-updates__item-unavailable">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  return (
    <section
      className={"recent-updates" + (isOpen ? " is-open" : "") + (isFull ? " is-full" : "")}
      aria-labelledby="recent-updates-title"
    >
      <h3 className="recent-updates__heading" id="recent-updates-title">
        <button
          type="button"
          className="recent-updates__title-toggle"
          aria-expanded={isOpen}
          aria-controls="recent-updates-content"
          onClick={() => setView(isOpen ? "collapsed" : "partial")}
        >
          <span className="recent-updates__heading-copy">
            <span className="recent-updates__heading-title">{t("updates.title")}</span>
            {!isOpen && (
              <span className="recent-updates__summary">
                {t("updates.summary", { added: added.length, changed: changed.length })}
              </span>
            )}
          </span>
          <motion.svg
            className="recent-updates__chevron"
            viewBox="0 0 12 12"
            aria-hidden="true"
            focusable="false"
            initial={false}
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={transition}
          >
            <path d="m3 4.5 3 3 3-3" />
          </motion.svg>
        </button>
      </h3>
      <motion.div
        id="recent-updates-content"
        className="recent-updates__content"
        aria-hidden={!isOpen}
        inert={!isOpen}
        initial={false}
        animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
        transition={transition}
      >
        <div className="recent-updates__content-inner">
          <p className="recent-updates__description">{t("updates.description")}</p>
          <motion.div
            className="recent-updates__groups-viewport"
            initial={false}
            animate={{ height: groupHeight }}
            transition={transition}
            style={{ maxHeight: isFull && (groupsBounds.height === 0 || fullHeight === 0) ? "60vh" : undefined }}
          >
            <div className="recent-updates__groups" id="recent-updates-groups" ref={groupsRef}>
              {renderGroup(t("updates.added"), added)}
              {renderGroup(t("updates.changed"), changed)}
            </div>
          </motion.div>
          <div className="recent-updates__measure" aria-hidden="true" inert>
            <div className="recent-updates__groups" ref={partialRef}>
              {renderGroup(t("updates.added"), added, VISIBLE_BY_DEFAULT, true)}
              {renderGroup(t("updates.changed"), changed, VISIBLE_BY_DEFAULT, true)}
            </div>
          </div>
          {hasMore && (
            <div className="recent-updates__actions">
              <button
                type="button"
                className="recent-updates__more"
                aria-label={t(isFull ? "updates.partial" : "updates.more")}
                title={t(isFull ? "updates.partial" : "updates.more")}
                aria-expanded={isFull}
                aria-controls="recent-updates-groups"
                onClick={() => setView(isFull ? "partial" : "full")}
              >
                <motion.svg
                  className="recent-updates__more-chevron"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  focusable="false"
                  initial={false}
                  animate={{ rotate: isFull ? 180 : 0 }}
                  transition={transition}
                >
                  <path d="m3 4.5 3 3 3-3" />
                </motion.svg>
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </section>
  );
}
