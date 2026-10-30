const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const vc = new VirtualConsole();
const errors = [];
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

(async () => {
  const file = path.join(__dirname, "..", "index.html");
  const dom = await JSDOM.fromFile(file, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "file:///" + file.replace(/\\/g, "/"),
  });
  await new Promise((res) => setTimeout(res, 1200));
  const doc = dom.window.document;

  const q = (s) => doc.querySelectorAll(s);
  console.log("=== 初次渲染 ===");
  console.log("点位 circles:", q("circle.pt").length);
  console.log("前沿虚线 path:", q("#chart path").length);
  console.log("表格行:", q("#tableBody tr").length);
  console.log("读数卡片:", q(".icard").length);
  console.log("前沿列表项:", q("#frontierList li").length);
  console.log("膝点标注:", q(".knee-mark text").length ? q(".knee-mark text")[0].textContent : "无");
  console.log("图表标题:", doc.querySelector("#chartTitle").textContent);
  console.log("hero 膝点:", doc.querySelector("#statKnee").textContent);
  console.log("说明:", doc.querySelector("#chartNote").textContent.slice(0, 80));

  // 交互：切换每个预设
  const chips = [...q("#presetChips .chip")];
  console.log("\n=== 预设切换 ===");
  console.log("chips:", chips.map((c) => c.textContent).join(" / "));
  for (const chip of chips) {
    chip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
    const title = doc.querySelector("#chartTitle").textContent;
    const knee = doc.querySelector(".knee-mark text") ? doc.querySelector(".knee-mark text").textContent : "无";
    console.log("[" + chip.textContent + "] 点位=" + q("circle.pt").length + " 膝点=" + knee + " 行=" + q("#tableBody tr").length + " 标题=" + title);
  }

  // 交互：筛选
  console.log("\n=== 筛选 ===");
  const open = doc.querySelector("#openOnly");
  open.checked = true;
  open.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  console.log("仅开源: 点位=" + q("circle.pt").length + " 行=" + q("#tableBody tr").length);
  open.checked = false;
  open.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // 表格排序
  const ths = [...q("#modelTable thead th")];
  ths.find((t) => t.dataset.sort === "cost").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  const firstRow = doc.querySelector("#tableBody tr td:nth-child(2)").textContent.trim();
  console.log("按成本排序首行:", firstRow);

  // hover 工具提示
  const pt = doc.querySelector("circle.pt");
  pt.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true, clientX: 100, clientY: 100 }));
  await new Promise((r) => setTimeout(r, 50));
  console.log("tooltip hidden:", doc.querySelector("#tooltip").hidden, "| 内容首行:", doc.querySelector("#tooltip h4") ? doc.querySelector("#tooltip h4").textContent : "-");

  console.log("\n=== 错误 ===");
  console.log(errors.length ? errors.join("\n") : "无");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
