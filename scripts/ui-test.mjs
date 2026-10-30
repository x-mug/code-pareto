// 对静态导出产物做"真跑一遍"的功能测试：本地起静态服务 + jsdom 加载 + 点击视角/筛选
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const OUT = path.resolve("out");
const PREFIX = "/code-pareto";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };

const server = http.createServer(async (req, res) => {
  let url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (url.startsWith(PREFIX)) url = url.slice(PREFIX.length);
  if (url.endsWith("/")) url += "index.html";
  const file = path.join(OUT, url);
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = "http://127.0.0.1:" + port + PREFIX + "/";

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message.slice(0, 200)));
vc.on("error", (...a) => errors.push("console.error: " + String(a[0]).slice(0, 200)));

const dom = await JSDOM.fromURL(base, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    class RO { observe() {} unobserve() {} disconnect() {} }
    class IO { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    window.ResizeObserver = RO;
    window.IntersectionObserver = IO;
    window.scrollTo = () => {};
    window.HTMLElement.prototype.scrollIntoView = () => {};
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = dom.window.document;
const q = (s) => doc.querySelectorAll(s);
const rows = () => q(".model-table__row").length;
const activeChip = () => [...q(".view-switch .legend-chip")].find((b) => b.classList.contains("is-active"))?.textContent?.trim();

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " :: " + detail : "")); }
}

await sleep(5000);
console.log("=== 初始状态 ===");
check("页面渲染出主结构", !!doc.querySelector(".site-header") && !!doc.querySelector(".chart-card"));
check("视角 chip >= 5", q(".view-switch .legend-chip").length >= 5, String(q(".view-switch .legend-chip").length));
check("默认视角=综合智能", (activeChip() || "").includes("综合"), activeChip());
check("默认表格 81 行", rows() === 81, String(rows()));
check("推荐卡存在", q(".recommendation-card, .recommendations__list > *").length > 0);
check("膝点徽章存在", q(".knee-badge").length > 0, String(q(".knee-badge").length));

console.log("=== 切换到纯编程 ===");
const codingChip = [...q(".view-switch .legend-chip")].find((b) => b.textContent.includes("纯编程"));
codingChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await sleep(800);
check("纯编程激活", (activeChip() || "").includes("纯编程"), activeChip());
check("表格 26 行", rows() === 26, String(rows()));
check("子集提示出现", !!doc.querySelector(".view-switch__subset"));
check("图表未炸（chart-card 仍在）", !!doc.querySelector(".chart-card"));

console.log("=== 切到自定义 + 权重面板 ===");
const customChip = [...q(".view-switch .legend-chip")].find((b) => b.textContent.includes("自定义"));
customChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await sleep(600);
check("权重面板出现", !!doc.querySelector(".view-weights"), "");
check("5 支滑杆", q(".view-weights input[type=range]").length === 5, String(q(".view-weights input[type=range]").length));

console.log("=== 开源权重筛选 ===");
const openChip = [...q(".view-switch .legend-chip")].find((b) => b.textContent.includes("开源权重"));
openChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await sleep(600);
const openRows = rows();
check("开源筛选后行数下降", openRows > 0 && openRows < 26, String(openRows));

console.log("=== 切回综合智能 ===");
const intelChip = [...q(".view-switch .legend-chip")].find((b) => b.textContent.includes("综合智能"));
intelChip.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await sleep(600);
check("综合视角表格恢复 81 行", rows() === 81, String(rows()));

console.log("=== 语言/主题开关 ===");
check("主题按钮存在", !!doc.querySelector(".theme-toggle, [class*=theme]"));
check("语言切换存在", !!doc.querySelector(".locale-switcher, [class*=locale]"));

console.log("\n=== 运行期错误（前 10 条）===");
console.log(errors.length ? errors.slice(0, 10).join("\n") : "无");
console.log("\n结果: " + pass + " passed, " + fail + " failed");
server.close();
dom.window.close();
process.exit(fail === 0 ? 0 : 1);
