const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.log("[jsdomError]", e.message));
(async () => {
  const file = path.join(__dirname, "..", "index.html");
  const dom = await JSDOM.fromFile(file, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc, url: "file:///" + file.replace(/\\/g, "/") });
  await new Promise((r) => setTimeout(r, 1200));
  const doc = dom.window.document;
  const M = { top: 26, right: 30, bottom: 62, left: 74 }, VW = 1080, VH = 660;
  const PW = VW - M.left - M.right, PH = VH - M.top - M.bottom;
  const num = (el, a) => parseFloat(el.getAttribute(a));

  const circles = [...doc.querySelectorAll("circle.pt")];
  let out = 0;
  for (const c of circles) {
    const cx = num(c, "cx"), cy = num(c, "cy");
    if (cx < M.left - 1 || cx > M.left + PW + 1 || cy < M.top - 1 || cy > M.top + PH + 1) { out++; console.log("  out of plot:", cx, cy); }
  }
  console.log("点位:", circles.length, "越界:", out);

  // 轴刻度文字是否越界
  const texts = [...doc.querySelectorAll("#chart text")];
  let clipped = 0;
  for (const t of texts) {
    const x = num(t, "x"), y = num(t, "y"), fs = parseFloat(t.getAttribute("font-size") || 11);
    if (x < 0 || x > VW || y < 0 || y > VH) { clipped++; console.log("  clipped text:", t.textContent, x, y); }
  }
  console.log("文字元素:", texts.length, "越界:", clipped);

  // 标签重叠粗检（前沿点名字）
  function box(t) {
    const x = num(t, "x"), y = num(t, "y"), fs = parseFloat(t.getAttribute("font-size") || 11);
    const w = t.textContent.length * fs * 0.62;
    const anchor = t.getAttribute("text-anchor") || "start";
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    return { x0, y0: y - fs, x1: x0 + w, y1: y + 3, text: t.textContent };
  }
  const labels = texts.filter((t) => t.getAttribute("font-size") === "11" && t.getAttribute("fill") && /rgba|#ffcf6e/.test(t.getAttribute("fill")));
  let overlaps = 0;
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = box(labels[i]), b = box(labels[j]);
    const ov = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    if (ov > 12) { overlaps++; if (overlaps < 6) console.log("  overlap:", a.text, "|", b.text); }
  }
  console.log("模型名标签:", labels.length, "明显重叠:", overlaps);

  // 膝点标注位置
  const kneeLabel = doc.querySelector(".knee-mark text");
  if (kneeLabel) { const b = box(kneeLabel); console.log("膝点标注框:", JSON.stringify(b)); }

  // 点坐标范围，判断是否挤在角落
  const xs = circles.map((c) => num(c, "cx"));
  console.log("x 像素范围:", Math.min(...xs).toFixed(0), "-", Math.max(...xs).toFixed(0), "绘图区:", M.left, "-", (M.left + PW).toFixed(0));
})().catch((e) => console.log("FATAL", e));
