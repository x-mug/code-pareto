import type { PillarKey, ViewKey } from "@/lib/models";
import {
  DEFAULT_CUSTOM_WEIGHTS,
  PILLARS,
  VIEW_ORDER,
  normalizeWeights,
  type PillarWeights,
} from "@/lib/view-logic";

/** 链接参数名，顺序就是写进地址栏的顺序 */
export const URL_STATE_KEYS = ["view", "open", "m", "w"] as const;

const [VIEW_PARAM, OPEN_PARAM, MODEL_PARAM, WEIGHTS_PARAM] = URL_STATE_KEYS;
const OPEN_VALUE = "1";

const OWN_PARAMS = new Set<string>(URL_STATE_KEYS);

/** 权重按百分比写进链接，保留两位小数 */
const WEIGHT_PERCENT_DECIMALS = 2;

/** 判断两组权重是否等价的容差 */
const WEIGHT_EQUAL_EPSILON = 1e-4;

export interface UrlViewState {
  view: ViewKey;
  /** 已归一化的支柱权重，总和为 1 */
  customWeights: PillarWeights;
  openOnly: boolean;
  /** null 表示链接没指定模型，页面继续用自己的默认选中 */
  selectedId: string | null;
}

export const DEFAULT_URL_VIEW_STATE: UrlViewState = {
  view: "intelligence",
  customWeights: DEFAULT_CUSTOM_WEIGHTS,
  openOnly: false,
  selectedId: null,
};

/** 每次返回独立对象，调用方改不坏默认值 */
function defaultUrlViewState(): UrlViewState {
  return {
    view: DEFAULT_URL_VIEW_STATE.view,
    customWeights: { ...DEFAULT_CUSTOM_WEIGHTS },
    openOnly: DEFAULT_URL_VIEW_STATE.openOnly,
    selectedId: null,
  };
}

function isPillarKey(value: string): value is PillarKey {
  return PILLARS.some((pillar) => pillar === value);
}

/** 比较两组权重实际生效的配比，先归一化再逐支比对 */
export function weightsEqual(a: PillarWeights, b: PillarWeights): boolean {
  const left = normalizeWeights(a);
  const right = normalizeWeights(b);
  return PILLARS.every(
    (pillar) => Math.abs(left[pillar] - right[pillar]) < WEIGHT_EQUAL_EPSILON,
  );
}

function formatWeightShare(value: number): string {
  const scale = 10 ** WEIGHT_PERCENT_DECIMALS;
  const percent = Math.round(value * 100 * scale) / scale;
  return String(percent);
}

/** 把权重编成 coding:60,akw:40 这种百分比片段，全为 0 时返回空串 */
function encodeWeights(weights: PillarWeights): string {
  const parts: string[] = [];
  let leader: PillarKey | null = null;
  let leaderValue = 0;

  for (const pillar of PILLARS) {
    const value = weights[pillar];
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value > leaderValue) {
      leader = pillar;
      leaderValue = value;
    }
    const percent = formatWeightShare(value);
    if (percent === "0") continue;
    parts.push(`${pillar}:${percent}`);
  }

  // 每支都小到舍成 0 时，把最大的一支记成 100，至少保住主导方向
  if (parts.length === 0 && leader) return `${leader}:100`;
  return parts.join(",");
}

/** 解析权重片段，非法支柱名和非法数值一律跳过，整段无效时回落到默认权重 */
function decodeWeights(raw: string | null): PillarWeights {
  if (!raw) return { ...DEFAULT_CUSTOM_WEIGHTS };

  const parsed: Partial<Record<PillarKey, number>> = {};
  for (const chunk of raw.split(",")) {
    const separator = chunk.indexOf(":");
    if (separator <= 0) continue;
    const key = chunk.slice(0, separator).trim();
    if (!isPillarKey(key)) continue;
    const value = Number(chunk.slice(separator + 1));
    if (!Number.isFinite(value) || value <= 0) continue;
    parsed[key] = value;
  }

  if (Object.keys(parsed).length === 0) return { ...DEFAULT_CUSTOM_WEIGHTS };
  return normalizeWeights(parsed);
}

function parseView(raw: string | null): ViewKey {
  return VIEW_ORDER.find((view) => view === raw) ?? DEFAULT_URL_VIEW_STATE.view;
}

function parseSelectedId(
  raw: string | null,
  knownModelIds: Iterable<string>,
): string | null {
  if (!raw) return null;
  for (const id of knownModelIds) {
    if (id === raw) return raw;
  }
  return null;
}

/** 只写偏离默认值的参数，默认视图、默认权重、未指定模型都不占链接 */
function urlStateEntries(state: UrlViewState): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  if (state.view !== DEFAULT_URL_VIEW_STATE.view) {
    entries.push([VIEW_PARAM, state.view]);
  }
  if (state.openOnly) {
    entries.push([OPEN_PARAM, OPEN_VALUE]);
  }
  if (state.selectedId) {
    entries.push([MODEL_PARAM, state.selectedId]);
  }
  if (!weightsEqual(state.customWeights, DEFAULT_CUSTOM_WEIGHTS)) {
    const encoded = encodeWeights(state.customWeights);
    if (encoded) entries.push([WEIGHTS_PARAM, encoded]);
  }

  return entries;
}

/** 保留冒号和逗号，权重参数在地址栏里保持可读 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

/** 按原始顺序拆开查询串，编码坏掉的片段原样保留 */
function splitSearch(search: string): Array<[string, string]> {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (!raw) return [];

  return raw
    .split("&")
    .filter((chunk) => chunk.length > 0)
    .map((chunk): [string, string] => {
      const separator = chunk.indexOf("=");
      if (separator < 0) return [decodeComponent(chunk), ""];
      return [
        decodeComponent(chunk.slice(0, separator)),
        decodeComponent(chunk.slice(separator + 1)),
      ];
    });
}

/** 把视图状态编成查询串，不含问号 */
export function encodeUrlState(state: UrlViewState): string {
  return urlStateEntries(state)
    .map(([key, value]) => `${encodeComponent(key)}=${encodeComponent(value)}`)
    .join("&");
}

/** 把视图状态合并进现有查询串，别人的参数原样留着，返回含问号的查询串 */
export function mergeUrlState(
  currentSearch: string,
  state: UrlViewState,
): string {
  const kept = splitSearch(currentSearch).filter(
    ([key]) => !OWN_PARAMS.has(key),
  );
  const entries = [...kept, ...urlStateEntries(state)];
  if (entries.length === 0) return "";

  return `?${entries
    .map(([key, value]) => `${encodeComponent(key)}=${encodeComponent(value)}`)
    .join("&")}`;
}

/** 从查询串还原视图状态，任何非法值都回落到默认值，绝不抛异常 */
export function decodeUrlState(
  search: string,
  knownModelIds: Iterable<string>,
): UrlViewState {
  try {
    const params = new URLSearchParams(
      typeof search === "string" ? search : "",
    );
    return {
      view: parseView(params.get(VIEW_PARAM)),
      customWeights: decodeWeights(params.get(WEIGHTS_PARAM)),
      openOnly: params.get(OPEN_PARAM) === OPEN_VALUE,
      selectedId: parseSelectedId(params.get(MODEL_PARAM), knownModelIds),
    };
  } catch {
    return defaultUrlViewState();
  }
}
