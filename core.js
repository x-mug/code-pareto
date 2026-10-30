/* CodePareto 纯计算层：权重合成、帕累托前沿、膝点检测。
   同时暴露为 window.AACore（浏览器）与 module.exports（Node，便于验证）。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AACore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PILLARS = ["coding", "akw", "science", "reasoning", "knowledge"];
  const PILLAR_LABEL = {
    coding: "Agentic Coding",
    akw: "Agentic Knowledge Work",
    science: "Science",
    reasoning: "Reasoning",
    knowledge: "Knowledge",
  };

  const PRESETS = {
    coding: { label: "纯编程", weights: { coding: 1 } },
    coding_eng: { label: "编程 + 工程", weights: { coding: 0.6, akw: 0.4 } },
    aa_eng: { label: "AA 工程指数", weights: { knowledge: 0.3, science: 0.2, reasoning: 0.2, coding: 0.15, akw: 0.15 } },
    aa_v5: { label: "AA 综合 v5", official: true },
  };

  function normalizeWeights(w) {
    w = w || {};
    const out = {};
    let sum = 0;
    for (const p of PILLARS) {
      const v = Number(w[p]) || 0;
      out[p] = v > 0 ? v : 0;
      sum += out[p];
    }
    if (sum <= 0) return { coding: 1 };
    for (const p of PILLARS) out[p] = out[p] / sum;
    return out;
  }

  // 一个模型在当前视角下的 (得分, 成本)
  function measure(model, weights, official) {
    if (official) {
      // AA 官方口径：直接用它公布的指数与每任务成本
      if (model.aaIndex == null || model.aaIndexCostPerTask == null) return null;
      return { score: model.aaIndex, cost: model.aaIndexCostPerTask };
    }
    let score = 0, cost = 0, wsum = 0;
    for (const p of PILLARS) {
      const w = weights[p] || 0;
      if (w <= 0) continue;
      const s = model.subScores[p];
      const c = model.pillarCost[p];
      if (s == null || c == null) return null;
      score += w * s;
      cost += w * c;
      wsum += w;
    }
    if (wsum <= 0) return null;
    return { score: score / wsum, cost: cost / wsum };
  }

  // 帕累托前沿：成本升序，得分严格递增
  function pareto(points) {
    const sorted = points.slice().sort((a, b) => a.cost - b.cost || b.score - a.score);
    const front = [];
    let best = -Infinity;
    for (const p of sorted) {
      if (p.score > best + 1e-9) {
        front.push(p);
        best = p.score;
      }
    }
    return front;
  }

  // Kneedle：在归一化的 (log 成本, 得分) 平面上，找离首尾连线最远的点
  function kneedle(frontier) {
    if (frontier.length < 3) return null;
    const xs = frontier.map((p) => Math.log10(Math.max(p.cost, 1e-6)));
    const ys = frontier.map((p) => p.score);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (xmax - xmin < 1e-9 || ymax - ymin < 1e-9) return null;
    const nx = xs.map((x) => (x - xmin) / (xmax - xmin));
    const ny = ys.map((y) => (y - ymin) / (ymax - ymin));
    const x0 = nx[0], y0 = ny[0], x1 = nx[nx.length - 1], y1 = ny[ny.length - 1];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    let bestIdx = -1, bestDist = -Infinity;
    for (let i = 1; i < frontier.length - 1; i++) {
      // 点到弦的有向距离：曲线上方（更划算）为正
      const dist = ((ny[i] - y0) * dx - (nx[i] - x0) * dy) / len;
      if (dist > bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx < 0 || bestDist <= 0.01) return null;
    return { index: bestIdx, point: frontier[bestIdx], distance: bestDist };
  }

  // 前沿相邻点之间的边际收益：每多花 1 美元（对数刻度）换多少分
  function marginalGains(frontier) {
    const out = [];
    for (let i = 1; i < frontier.length; i++) {
      const a = frontier[i - 1], b = frontier[i];
      const dCost = b.cost - a.cost;
      const dLog = Math.log10(b.cost || 1e-6) - Math.log10(a.cost || 1e-6);
      out.push({
        from: a, to: b,
        dScore: b.score - a.score,
        dCost,
        perLog: dLog !== 0 ? (b.score - a.score) / dLog : null,
      });
    }
    return out;
  }

  function rankBy(items, key, dir) {
    const sorted = items.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir === "asc" ? av - bv : bv - av;
    });
    const rank = new Map();
    sorted.forEach((m, i) => rank.set(m.id, i + 1));
    return rank;
  }

  return { PILLARS, PILLAR_LABEL, PRESETS, normalizeWeights, measure, pareto, kneedle, marginalGains, rankBy };
});
