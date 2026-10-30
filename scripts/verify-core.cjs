const fs = require("fs");
const path = require("path");
const AACore = require(path.join(__dirname, "..", "core.js"));
const raw = fs.readFileSync(path.join(__dirname, "..", "data.js"), "utf8");
const data = JSON.parse(raw.replace(/^window\.AA_DATA = /, "").replace(/;\s*$/, ""));

function summarize(presetKey) {
  const w = AACore.normalizeWeights(AACore.PRESETS[presetKey].weights);
  const pts = data.models.map((m) => {
    const mm = AACore.measure(m, w, false);
    return mm && mm.cost > 0.01 ? { id: m.id, name: m.name, cost: mm.cost, score: mm.score, open: m.isOpenWeights } : null;
  }).filter(Boolean);
  const front = AACore.pareto(pts);
  const knee = AACore.kneedle(front);
  console.log("\n== " + presetKey + " (n=" + pts.length + ") ==");
  console.log("frontier:");
  for (const p of front) console.log("   " + p.name.padEnd(40) + p.score.toFixed(1).padStart(6) + "  $" + p.cost.toFixed(2).padStart(7) + (p.open ? "  [开源]" : ""));
  console.log("knee:", knee ? knee.point.name + " score=" + knee.point.score.toFixed(1) + " cost=$" + knee.point.cost.toFixed(2) + " dist=" + knee.distance.toFixed(3) : "none");
  return { pts, front, knee };
}
for (const k of ["coding", "coding_eng", "aa_eng"]) summarize(k);

const pts5 = data.models.map((m) => (m.aaIndex != null && m.aaIndexCostPerTask > 0.01 ? { id: m.id, name: m.name, cost: m.aaIndexCostPerTask, score: m.aaIndex, open: m.isOpenWeights } : null)).filter(Boolean);
const f5 = AACore.pareto(pts5);
const k5 = AACore.kneedle(f5);
console.log("\n== aa_v5 ==");
for (const p of f5) console.log("   " + p.name.padEnd(40) + p.score.toFixed(1).padStart(6) + "  $" + p.cost.toFixed(2).padStart(7));
console.log("knee:", k5 ? k5.point.name + " $" + k5.point.cost.toFixed(2) : "none");
