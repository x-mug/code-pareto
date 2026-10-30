const fs = require("fs");
const path = require("path");
const C = require(path.join(__dirname, "..", "core.js"));
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8").replace("window.AA_DATA = ", "").trim().replace(/;\s*$/, ""));
const MIN = 0.01;

function view(key) {
  const cfg = C.PRESETS[key];
  if (!cfg.weights) {
    const rows = d.models.filter((m) => m.aaIndex != null && m.aaIndexCostPerTask != null)
      .map((m) => ({ m, score: m.aaIndex, cost: m.aaIndexCostPerTask }));
    return { rows, pts: rows.map((r) => ({ ...r, name: r.m.name, open: r.m.isOpenWeights })) };
  }
  const w = C.normalizeWeights(cfg.weights);
  const rows = d.models.map((m) => { const x = C.measure(m, w, false); return x ? { m, score: x.score, cost: x.cost } : null; }).filter(Boolean);
  return { rows, pts: rows.filter((r) => r.cost > MIN).map((r) => ({ ...r, name: r.m.name, open: r.m.isOpenWeights })) };
}
for (const key of ["coding", "coding_eng", "aa_eng", "aa_v5"]) {
  const { pts } = view(key);
  const front = C.pareto(pts);
  const knee = C.kneedle(front);
  const best = pts.reduce((a, b) => (a.score > b.score ? a : b));
  console.log("\n### " + key);
  if (knee) console.log("knee: " + knee.point.name + "  score=" + knee.point.score.toFixed(1) + "  $" + knee.point.cost.toFixed(2) + "  frontier#" + (front.findIndex((p) => p.name === knee.point.name) + 1) + "/" + front.length);
  console.log("best: " + best.name + "  score=" + best.score.toFixed(1) + "  $" + best.cost.toFixed(2));
  if (knee) console.log("best/knee: " + (best.score / knee.point.score).toFixed(2) + "x score, " + (best.cost / knee.point.cost).toFixed(1) + "x cost");
  const opens = pts.filter((p) => p.open).sort((a, b) => b.score - a.score);
  console.log("top open: " + opens.slice(0, 3).map((p) => p.name + " " + p.score.toFixed(1) + "@$" + p.cost.toFixed(2)).join(" | "));
}

// 排名变化：纯编程 vs AA v5
const coding = view("coding"), v5 = view("aa_v5");
const rank = (rows) => { const s = rows.slice().sort((a, b) => b.score - a.score); const m = new Map(); s.forEach((r, i) => m.set(r.m.id, i + 1)); return m; };
const r1 = rank(coding.rows), r2 = rank(v5.rows);
const moves = coding.rows.map((r) => ({ name: r.m.name, open: r.m.isOpenWeights, c: r1.get(r.m.id), a: r2.get(r.m.id), d: r2.get(r.m.id) - r1.get(r.m.id), cs: r.score, as: r.m.aaIndex }))
  .filter((x) => x.a && x.c).sort((x, y) => y.d - x.d);
console.log("\n### 排名上升（编程视角 vs AA v5）");
for (const m of moves.slice(0, 5)) console.log("  " + m.name.padEnd(38) + " v5#" + m.a + " -> 编程#" + m.c + "  (+" + m.d + ")");
console.log("### 排名下降");
for (const m of moves.slice(-5)) console.log("  " + m.name.padEnd(38) + " v5#" + m.a + " -> 编程#" + m.c + "  (" + m.d + ")");
