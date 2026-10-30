const fs = require("fs");
const path = require("path");
const C = require(path.join(__dirname, "..", "core.js"));
const raw = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8").replace("window.AA_DATA = ", "").trim();
const d = JSON.parse(raw.replace(/;\s*$/, ""));
const MIN = 0.01;
for (const k of ["coding", "coding_eng", "aa_eng"]) {
  const w = C.normalizeWeights(C.PRESETS[k].weights);
  const pts = d.models.map((m) => { const x = C.measure(m, w, false); return x && x.cost > MIN ? { id: m.id, name: m.name, cost: x.cost, score: x.score, open: m.isOpenWeights } : null; }).filter(Boolean);
  const f = C.pareto(pts);
  const kn = C.kneedle(f);
  console.log("\n" + k + "  knee => " + (kn ? kn.point.name + " " + kn.point.score.toFixed(1) + " @ $" + kn.point.cost.toFixed(2) : "none"));
  console.log("  frontier: " + f.map((p) => p.name.replace(/ \(.*?\)/, "") + " " + p.score.toFixed(1) + "@" + p.cost.toFixed(2)).join(" | "));
  console.log("  marginal: " + C.marginalGains(f).map((g) => g.to.name.replace(/ \(.*?\)/, "") + ":" + (g.perLog == null ? "-" : g.perLog.toFixed(0))).join("  "));
}
