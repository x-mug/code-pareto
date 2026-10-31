import { describe, expect, it } from "vitest";

import {
  DEFAULT_URL_VIEW_STATE,
  URL_STATE_KEYS,
  decodeUrlState,
  encodeUrlState,
  mergeUrlState,
  weightsEqual,
  type UrlViewState,
} from "@/lib/url-state";
import {
  DEFAULT_CUSTOM_WEIGHTS,
  PILLARS,
  VIEW_ORDER,
  normalizeWeights,
  type PillarWeights,
} from "@/lib/view-logic";

const MODEL_IDS = ["model-a", "model-b", "model-c"];

function expected(overrides: Partial<UrlViewState> = {}): UrlViewState {
  return {
    view: DEFAULT_URL_VIEW_STATE.view,
    customWeights: { ...DEFAULT_CUSTOM_WEIGHTS },
    openOnly: DEFAULT_URL_VIEW_STATE.openOnly,
    selectedId: null,
    ...overrides,
  };
}

function weights(overrides: Partial<PillarWeights>): PillarWeights {
  return { ...DEFAULT_CUSTOM_WEIGHTS, ...overrides };
}

describe("encodeUrlState", () => {
  it("默认状态不写任何参数", () => {
    expect(encodeUrlState(expected())).toBe("");
    expect(encodeUrlState(DEFAULT_URL_VIEW_STATE)).toBe("");
  });

  it("完整状态按固定顺序写四个参数", () => {
    const encoded = encodeUrlState(
      expected({
        view: "custom",
        openOnly: true,
        selectedId: "model-b",
        customWeights: weights({
          coding: 0.5,
          akw: 0.25,
          science: 0.125,
          reasoning: 0.0625,
          knowledge: 0.0625,
        }),
      }),
    );

    expect(encoded).toBe(
      "view=custom&open=1&m=model-b&w=coding:50,akw:25,science:12.5,reasoning:6.25,knowledge:6.25",
    );
  });

  it("只写部分参数时不多写别的", () => {
    expect(encodeUrlState(expected({ view: "coding" }))).toBe("view=coding");
    expect(encodeUrlState(expected({ openOnly: true }))).toBe("open=1");
    expect(encodeUrlState(expected({ selectedId: "model-c" }))).toBe("m=model-c");
  });

  it("权重偏离默认值才写 w 参数", () => {
    expect(
      encodeUrlState(
        expected({ customWeights: weights({ coding: 0.7, akw: 0.3 }) }),
      ),
    ).toBe("w=coding:70,akw:30");
    // 归一化后与默认等价的自定义权重不写
    expect(
      encodeUrlState(
        expected({
          customWeights: { coding: 0.3, akw: 0.2, science: 0, reasoning: 0, knowledge: 0 },
        }),
      ),
    ).toBe("");
  });

  it("权重都小到舍成 0 时保留最大的一支", () => {
    expect(
      encodeUrlState(
        expected({
          customWeights: {
            coding: 0.00002,
            akw: 0.00001,
            science: 0,
            reasoning: 0,
            knowledge: 0,
          },
        }),
      ),
    ).toBe("w=coding:100");
  });

  it("权重按百分比四舍五入到两位小数", () => {
    const encoded = encodeUrlState(
      expected({
        customWeights: {
          coding: 0.123456789,
          akw: 0.876543211,
          science: 0,
          reasoning: 0,
          knowledge: 0,
        },
      }),
    );

    expect(encoded).toBe("w=coding:12.35,akw:87.65");
  });
});

describe("decodeUrlState", () => {
  it("空查询串回落到默认状态", () => {
    expect(decodeUrlState("", MODEL_IDS)).toEqual(expected());
    expect(decodeUrlState("?", MODEL_IDS)).toEqual(expected());
    expect(decodeUrlState("?utm_source=share", MODEL_IDS)).toEqual(expected());
  });

  it("完整查询串精确还原状态", () => {
    const original = expected({
      view: "custom",
      openOnly: true,
      selectedId: "model-b",
      customWeights: weights({
        coding: 0.5,
        akw: 0.25,
        science: 0.125,
        reasoning: 0.0625,
        knowledge: 0.0625,
      }),
    });

    expect(decodeUrlState(`?${encodeUrlState(original)}`, MODEL_IDS)).toEqual(
      original,
    );
  });

  it("只带部分参数时其余用默认值", () => {
    expect(decodeUrlState("?view=coding", MODEL_IDS)).toEqual(
      expected({ view: "coding" }),
    );
    expect(decodeUrlState("?open=1", MODEL_IDS)).toEqual(
      expected({ openOnly: true }),
    );
    expect(decodeUrlState("?m=model-c", MODEL_IDS)).toEqual(
      expected({ selectedId: "model-c" }),
    );
    expect(decodeUrlState("?w=coding:60,akw:40", MODEL_IDS)).toEqual(
      expected({ customWeights: normalizeWeights({ coding: 0.6, akw: 0.4 }) }),
    );
  });

  it("非法 view 回落到综合视角", () => {
    const invalid = [
      "unknown",
      "",
      "CODING",
      "codingEngineering2",
      "__proto__",
      "coding ",
    ];

    for (const raw of invalid) {
      expect(decodeUrlState(`?view=${encodeURIComponent(raw)}`, MODEL_IDS).view).toBe(
        "intelligence",
      );
    }
  });

  it("所有合法视角都能往返", () => {
    for (const view of VIEW_ORDER) {
      const state = expected({ view });
      expect(decodeUrlState(`?${encodeUrlState(state)}`, MODEL_IDS).view).toBe(view);
    }
  });

  it("非法权重回落到默认权重", () => {
    const invalid = [
      "coding",
      "coding:",
      "coding:abc",
      "coding:-10",
      "coding:NaN",
      "coding:Infinity",
      "unknown:50",
      "CODING:50",
      ":::",
      "coding:0",
      "coding:0.0",
    ];

    for (const raw of invalid) {
      expect(
        decodeUrlState(`?w=${encodeURIComponent(raw)}`, MODEL_IDS),
      ).toEqual(expected());
    }
  });

  it("权重片段部分非法时只保留合法支柱", () => {
    expect(decodeUrlState("?w=coding:30,akw:oops,science:20", MODEL_IDS)).toEqual(
      expected({ customWeights: normalizeWeights({ coding: 30, science: 20 }) }),
    );
    expect(decodeUrlState("?w=coding:2,akw:1", MODEL_IDS)).toEqual(
      expected({ customWeights: normalizeWeights({ coding: 2, akw: 1 }) }),
    );
  });

  it("读进来的权重再写回去还是同一个链接", () => {
    const encoded = "view=custom&w=coding:42.86,akw:57.14";
    expect(encodeUrlState(decodeUrlState(`?${encoded}`, MODEL_IDS))).toBe(encoded);
    // 没写归一的权重会被规范化一次，之后就稳定了
    expect(
      encodeUrlState(decodeUrlState("?w=coding:2,akw:1", MODEL_IDS)),
    ).toBe("w=coding:66.67,akw:33.33");
  });

  it("百分号编码过的权重同样能解", () => {
    expect(
      decodeUrlState("?w=coding%3A60%2Cakw%3A40", MODEL_IDS),
    ).toEqual(
      expected({ customWeights: normalizeWeights({ coding: 0.6, akw: 0.4 }) }),
    );
  });

  it("未知模型 id 一律丢弃", () => {
    expect(decodeUrlState("?m=ghost", MODEL_IDS).selectedId).toBeNull();
    expect(decodeUrlState("?m=", MODEL_IDS).selectedId).toBeNull();
    expect(decodeUrlState("?m=model-a", []).selectedId).toBeNull();
    expect(decodeUrlState("?m=%E0%A4%A", MODEL_IDS).selectedId).toBeNull();
  });

  it("已知模型 id 才接受，重复参数取第一个", () => {
    expect(decodeUrlState("?m=model-a", MODEL_IDS).selectedId).toBe("model-a");
    expect(decodeUrlState("?m=model-a&m=model-b", MODEL_IDS).selectedId).toBe(
      "model-a",
    );
    expect(decodeUrlState("?m=model-c", new Set(MODEL_IDS)).selectedId).toBe(
      "model-c",
    );
  });

  it("open 只认 1", () => {
    expect(decodeUrlState("?open=1", MODEL_IDS).openOnly).toBe(true);
    for (const raw of ["0", "true", "yes", "", "2", "01", "1.0"]) {
      expect(decodeUrlState(`?open=${raw}`, MODEL_IDS).openOnly).toBe(false);
    }
  });

  it("只取自己认识的参数，其余忽略", () => {
    expect(
      decodeUrlState("?utm_source=x&view=coding&ts=123", MODEL_IDS),
    ).toEqual(expected({ view: "coding" }));
  });

  it("返回的权重是独立对象，改不动默认值", () => {
    const first = decodeUrlState("?w=coding:60,akw:40", MODEL_IDS);
    first.customWeights.coding = 0.99;

    expect(DEFAULT_CUSTOM_WEIGHTS.coding).toBe(0.6);
    expect(decodeUrlState("?w=coding:60,akw:40", MODEL_IDS).customWeights.coding).toBe(
      0.6,
    );
  });

  it("再离谱的查询串也不抛异常", () => {
    const nasty = [
      "?",
      "??",
      "?%",
      "?%%%",
      "?view",
      "?=",
      "?&&&",
      "?view=coding&&&",
      "?w=::::",
      "?%E0%A4%A=1",
      `?${"a".repeat(4096)}`,
      `?view=${"x".repeat(1024)}`,
    ];

    for (const search of nasty) {
      const state = decodeUrlState(search, MODEL_IDS);
      expect(VIEW_ORDER).toContain(state.view);
      expect(state.selectedId).toBeNull();
      const sum = PILLARS.reduce((total, pillar) => total + state.customWeights[pillar], 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });
});

describe("mergeUrlState", () => {
  it("空地址栏写完整查询串", () => {
    expect(mergeUrlState("", expected({ openOnly: true }))).toBe("?open=1");
    expect(mergeUrlState("?", expected({ view: "coding" }))).toBe("?view=coding");
  });

  it("保留别人的参数", () => {
    expect(
      mergeUrlState("?utm_source=x", expected({ view: "coding" })),
    ).toBe("?utm_source=x&view=coding");
    expect(
      mergeUrlState("?view=coding&utm_source=x&open=1", expected()),
    ).toBe("?utm_source=x");
  });

  it("覆盖同名参数且不重复", () => {
    expect(
      mergeUrlState(
        "?view=coding&utm_source=x&open=1",
        expected({ view: "aaEngineering", openOnly: true }),
      ),
    ).toBe("?utm_source=x&view=aaEngineering&open=1");
  });

  it("重复合并结果不变", () => {
    const state = expected({
      view: "custom",
      openOnly: true,
      selectedId: "model-b",
      customWeights: weights({ coding: 0.5, akw: 0.25, science: 0.25 }),
    });
    const once = mergeUrlState("?utm=1&view=coding&m=model-a", state);

    expect(mergeUrlState(once, state)).toBe(once);
    expect(decodeUrlState(once, MODEL_IDS)).toEqual(state);
  });

  it("状态回到默认时清掉自己的参数", () => {
    const withParams = mergeUrlState(
      "",
      expected({ view: "coding", openOnly: true, selectedId: "model-a" }),
    );

    expect(mergeUrlState(withParams, expected())).toBe("");
  });
});

describe("weightsEqual", () => {
  it("归一化后配比相同就算相等", () => {
    expect(weightsEqual(weights({ coding: 0.3, akw: 0.2 }), DEFAULT_CUSTOM_WEIGHTS)).toBe(
      true,
    );
    expect(
      weightsEqual(
        weights({ coding: 0.6, akw: 0.4 }),
        weights({ coding: 0.6, akw: 0.4 }),
      ),
    ).toBe(true);
  });

  it("配比不同就判为不等", () => {
    expect(weightsEqual(weights({ coding: 0.5, akw: 0.5 }), DEFAULT_CUSTOM_WEIGHTS)).toBe(
      false,
    );
    expect(weightsEqual(weights({ coding: 0 }), weights({ akw: 1 }))).toBe(false);
  });
});

describe("参数契约", () => {
  it("参数名固定为 view/open/m/w", () => {
    expect([...URL_STATE_KEYS]).toEqual(["view", "open", "m", "w"]);
  });
});
