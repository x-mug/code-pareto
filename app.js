/* CodePareto 前端：散点图 + 帕累托前沿 + 膝点 + 表格。依赖 data.js 与 core.js。 */
(function () {
  "use strict";

  const D = window.AA_DATA;
  const C = window.AACore;
  const MIN_COST = 0.01;          // 低于 1 美分的按免费档处理，不进对数轴
  const $ = (sel) => document.querySelector(sel);
  const svgNS = "http://www.w3.org/2000/svg";

  const state = {
    preset: "coding",
    weights: C.normalizeWeights(C.PRESETS.coding.weights),
    openOnly: false,
    reasoningOnly: false,
    providers: new Set(D.models.map((m) => m.creatorSlug)),
    sortKey: "score",
    sortDir: "desc",
    pinned: null,
    hovered: null,
  };

  const allModels = D.models.map((m) => ({ ...m }));
  const providerMeta = [];
  const seen = new Set();
  for (const m of allModels) {
    if (seen.has(m.creatorSlug)) continue;
    seen.add(m.creatorSlug);
    providerMeta.push({ slug: m.creatorSlug, name: m.creator, color: m.color });
  }

  // ---------- 计算 ----------
  function official() {
    return state.preset === "aa_v5";
  }

  function computeRows() {
    const rows = [];
    for (const m of allModels) {
      if (state.openOnly && !m.isOpenWeights) continue;
      if (state.reasoningOnly && !m.isReasoning) continue;
      if (!state.providers.has(m.creatorSlug)) continue;
      const officialFlag = official();
      const mm = C.measure(m, state.weights, officialFlag);
      rows.push({ model: m, score: mm ? mm.score : null, cost: mm ? mm.cost : null });
    }
    return rows;
  }

  function rankMap(rows, key) {
    const sorted = rows.filter((r) => r[key] != null).slice().sort((a, b) => b[key] - a[key]);
    const map = new Map();
    sorted.forEach((r, i) => map.set(r.model.id, i + 1));
    return map;
  }

  function buildView() {
    const rows = computeRows();
    const plotRows = rows.filter((r) => r.cost != null && r.cost > MIN_COST && r.score != null);
    const rankScore = rankMap(rows, "score");
    const rankAA = rankMap(allModels.map((m) => ({ model: m, score: m.aaIndex })), "score");
    const points = plotRows.map((r) => ({
      id: r.model.id,
      name: r.model.name,
      model: r.model,
      score: r.score,
      cost: r.cost,
      open: r.model.isOpenWeights,
    }));
    const frontier = C.pareto(points);
    const knee = C.kneedle(frontier);
    return { rows, points, frontier, knee, rankScore, rankAA };
  }

  // ---------- 格式化 ----------
  const fmtCost = (v) => (v == null ? "—" : v >= 1 ? "$" + v.toFixed(2) : "$" + v.toFixed(3));
  const fmtScore = (v) => (v == null ? "—" : v.toFixed(1));
  const shortName = (n) => n.replace(/\s*\(.*?\)\s*$/, "");
  const suffix = (n) => {
    const m = n.match(/\((.*?)\)\s*$/);
    return m ? m[1] : "";
  };

  // ---------- 渲染：控制区 ----------
  function renderPresets() {
    const box = $("#presetChips");
    box.innerHTML = "";
    const entries = Object.entries(C.PRESETS);
    if (state.preset === "custom") entries.push(["custom", { label: "自定义" }]);
    for (const [key, cfg] of entries) {
      const b = document.createElement("button");
      b.className = "chip" + (state.preset === key ? " active" : "");
      b.textContent = cfg.label;
      b.onclick = () => {
        state.preset = key;
        const cfg = C.PRESETS[key];
        if (cfg && cfg.weights) state.weights = C.normalizeWeights(cfg.weights);
        renderAll();
      };
      box.appendChild(b);
    }
  }

  function renderSliders() {
    const box = $("#weightSliders");
    const panel = $("#weightsPanel");
    if (panel) {
      const off = state.preset === "aa_v5";
      panel.classList.toggle("disabled", off);
      panel.title = off ? "AA 官方综合指数不使用可调权重" : "";
    }
    box.innerHTML = "";
    for (const p of C.PILLARS) {
      const v = Math.round((state.weights[p] || 0) * 100);
      const row = document.createElement("div");
      row.className = "slider-row" + (v === 0 ? " zero" : "");
      row.innerHTML =
        '<div class="slabel"><span>' + C.PILLAR_LABEL[p] + "</span><b>" + v + "%</b></div>" +
        '<input type="range" min="0" max="100" step="5" value="' + v + '" />';
      const input = row.querySelector("input");
      input.oninput = () => {
        const raw = { ...state.weights };
        raw[p] = Number(input.value) / 100;
        const total = Object.values(raw).reduce((a, b) => a + b, 0);
        if (total <= 0) return;
        state.preset = "custom";
        state.weights = C.normalizeWeights(raw);
        row.querySelector("b").textContent = input.value + "%";
        row.classList.toggle("zero", Number(input.value) === 0);
        renderPresets();
        renderData();
      };
      box.appendChild(row);
    }
  }

  function renderProviders() {
    const box = $("#providerChips");
    box.innerHTML = "";
    for (const p of providerMeta) {
      const b = document.createElement("button");
      b.className = "pchip" + (state.providers.has(p.slug) ? "" : " off");
      b.innerHTML = '<span class="swatch" style="background:' + p.color + '"></span>' + p.name;
      b.onclick = () => {
        if (state.providers.has(p.slug)) state.providers.delete(p.slug);
        else state.providers.add(p.slug);
        renderAll();
      };
      box.appendChild(b);
    }
  }

  // ---------- 渲染：SVG ----------
  const M = { top: 26, right: 30, bottom: 62, left: 74 };
  const VW = 1080, VH = 660;
  const PW = VW - M.left - M.right, PH = VH - M.top - M.bottom;

  function el(name, attrs, parent) {
    const n = document.createElementNS(svgNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function xScaleFactory(domain) {
    return (v) => {
      const t = (Math.log10(v) - domain[0]) / (domain[1] - domain[0]);
      return M.left + t * PW;
    };
  }

  function renderChart(view) {
    const svg = $("#chart");
    svg.innerHTML = "";
    const pts = view.points;
    if (!pts.length) {
      el("text", { x: VW / 2, y: VH / 2, "text-anchor": "middle", fill: "#8b97ad", "font-size": 15 }, svg).textContent = "当前筛选下没有可比较的模型";
      return;
    }

    const logs = pts.map((p) => Math.log10(p.cost));
    const xmin = Math.min(...logs), xmax = Math.max(...logs);
    const padX = Math.max((xmax - xmin) * 0.07, 0.08);
    const xd = [xmin - padX, xmax + padX];
    const x = xScaleFactory(xd);

    const maxScore = Math.max(...pts.map((p) => p.score));
    const yTop = Math.max(10, Math.ceil((maxScore * 1.1) / 10) * 10);
    const y = (v) => M.top + PH - (v / yTop) * PH;

    // 左上角“更划算”渐变
    const defs = el("defs", {}, svg);
    const grad = el("radialGradient", { id: "quad", cx: "0%", cy: "0%", r: "80%" }, defs);
    el("stop", { offset: "0%", "stop-color": "#6ff0c4", "stop-opacity": "0.1" }, grad);
    el("stop", { offset: "100%", "stop-color": "#6ff0c4", "stop-opacity": "0" }, grad);
    el("rect", { x: M.left, y: M.top, width: PW, height: PH, fill: "url(#quad)", "pointer-events": "none" }, svg);

    // 网格 + 坐标轴
    const g = el("g", {}, svg);
    // y ticks
    let step = yTop <= 40 ? 5 : 10;
    for (let v = 0; v <= yTop + 0.001; v += step) {
      const yy = y(v);
      el("line", { x1: M.left, y1: yy, x2: M.left + PW, y2: yy, stroke: "rgba(255,255,255,0.055)", "stroke-width": 1 }, g);
      const t = el("text", { x: M.left - 12, y: yy + 4, "text-anchor": "end", fill: "#6b7689", "font-size": 11 }, g);
      t.textContent = v;
    }
    // x ticks: 1 / 2 / 5 × 10^k
    const tickVals = [];
    for (let k = Math.floor(xd[0]); k <= Math.ceil(xd[1]); k++) {
      for (const mult of [1, 2, 5]) {
        const v = mult * Math.pow(10, k);
        const l = Math.log10(v);
        if (l >= xd[0] && l <= xd[1]) tickVals.push(v);
      }
    }
    for (const v of tickVals) {
      const xx = x(v);
      el("line", { x1: xx, y1: M.top, x2: xx, y2: M.top + PH, stroke: "rgba(255,255,255,0.04)", "stroke-width": 1 }, g);
      const t = el("text", { x: xx, y: M.top + PH + 22, "text-anchor": "middle", fill: "#6b7689", "font-size": 11 }, g);
      t.textContent = v >= 1 ? "$" + v : "$" + v.toFixed(2);
    }
    // 轴标题
    const xl = el("text", { x: M.left + PW / 2, y: M.top + PH + 50, "text-anchor": "middle", fill: "#8b97ad", "font-size": 12 }, g);
    xl.textContent = "每任务成本（USD，对数刻度）";
    const yl = el("text", { x: 20, y: M.top + PH / 2, "text-anchor": "middle", fill: "#8b97ad", "font-size": 12, transform: "rotate(-90 20 " + (M.top + PH / 2) + ")" }, g);
    yl.textContent = "能力得分（0–100）";

    // 帕累托前沿
    if (view.frontier.length > 1) {
      const d = view.frontier.map((p, i) => (i === 0 ? "M" : "L") + x(p.cost).toFixed(1) + " " + y(p.score).toFixed(1)).join(" ");
      el("path", { d, fill: "none", stroke: "rgba(111,240,196,0.55)", "stroke-width": 1.6, "stroke-dasharray": "5 5" }, svg);
    }

    // 前沿点集合
    const frontIds = new Set(view.frontier.map((p) => p.id));
    const kneeId = view.knee ? view.knee.point.id : null;

    // 普通点
    const dotsG = el("g", {}, svg);
    const sorted = pts.slice().sort((a, b) => b.score - a.score);
    for (const p of sorted) {
      const cx = x(p.cost), cy = y(p.score);
      if (frontIds.has(p.id)) {
        el("circle", { cx, cy, r: 11, fill: "none", stroke: "rgba(111,240,196,0.22)", "stroke-width": 1 }, dotsG);
      }
      const c = el("circle", {
        cx, cy, r: 6.4,
        fill: p.model.color,
        stroke: "rgba(7,10,17,0.9)",
        "stroke-width": 1.5,
        "data-id": p.id,
        class: "pt",
        style: "cursor:pointer;transition:r .15s ease, opacity .15s ease",
      }, dotsG);
      c.addEventListener("mouseenter", (e) => showTooltip(e, p, view));
      c.addEventListener("mousemove", (e) => moveTooltip(e));
      c.addEventListener("mouseleave", hideTooltip);
      c.addEventListener("click", () => {
        state.pinned = state.pinned === p.id ? null : p.id;
        renderAll();
      });
    }

    // 膝点：脉冲圈 + 标注
    if (view.knee) {
      const kp = view.knee.point;
      const kx = x(kp.cost), ky = y(kp.score);
      const gk = el("g", { class: "knee-mark" }, svg);
      el("circle", { cx: kx, cy: ky, r: 15, fill: "none", stroke: "#ffcf6e", "stroke-width": 1.2, opacity: 0.5, class: "knee-ring" }, gk);
      el("circle", { cx: kx, cy: ky, r: 9, fill: "none", stroke: "#ffcf6e", "stroke-width": 2 }, gk);
      // 标注
      const right = kx < M.left + PW * 0.66;
      const lx = right ? kx + 24 : kx - 24;
      const anchor = right ? "start" : "end";
      const ty = Math.max(ky - 26, M.top + 14);
      const label = "膝点 · " + shortName(kp.name);
      const tw = label.length * 7.2 + 26;
      const bx = right ? lx - 10 : lx - tw + 10;
      el("rect", { x: bx, y: ty - 15, width: tw, height: 26, rx: 13, fill: "rgba(255,207,110,0.16)", stroke: "rgba(255,207,110,0.5)" }, gk);
      const tx = right ? lx + 3 : lx - 3;
      const t = el("text", { x: tx, y: ty + 2, "text-anchor": anchor, fill: "#ffcf6e", "font-size": 12, "font-weight": 600 }, gk);
      t.textContent = label;
      el("line", { x1: kx, y1: ky - 12, x2: kx, y2: ty + 12, stroke: "rgba(255,207,110,0.4)", "stroke-width": 1, "stroke-dasharray": "3 3" }, gk);
    }

    // 前沿点名字
    const labs = view.frontier.slice().sort((a, b) => b.score - a.score);
    let lastY = { left: -1e9, right: -1e9 };
    for (const p of labs) {
      const px = x(p.cost), py = y(p.score);
      const right = px < M.left + PW * 0.7;
      const side = right ? "left" : "right";
      let ty = py - 13;
      if (ty - lastY[side] < 15) ty = lastY[side] + 15;
      lastY[side] = ty;
      const anchor = right ? "start" : "end";
      const tx = right ? px + 14 : px - 14;
      const t = el("text", { x: tx, y: ty, "text-anchor": anchor, fill: p.id === kneeId ? "#ffcf6e" : "rgba(233,238,248,0.78)", "font-size": 11 }, svg);
      t.textContent = shortName(p.name);
    }

    // 固定选中的点
    if (state.pinned) {
      const p = pts.find((q) => q.id === state.pinned);
      if (p) {
        const cx = x(p.cost), cy = y(p.score);
        el("circle", { cx, cy, r: 14, fill: "none", stroke: "#fff", "stroke-width": 1.6, "stroke-dasharray": "3 3" }, svg);
      }
    }
  }

  // ---------- 提示框 ----------
  const tooltip = $("#tooltip");
  function showTooltip(e, p, view) {
    state.hovered = p.id;
    const m = p.model;
    const rank = view.rankScore.get(m.id);
    const aaRank = view.rankAA.get(m.id);
    const delta = rank && aaRank ? aaRank - rank : null;
    tooltip.hidden = false;
    tooltip.innerHTML =
      "<h4>" + m.name + "</h4>" +
      '<div class="sub">' + m.creator + " · " + (m.releaseDate || "") + (m.isOpenWeights ? " · 开源权重" : "") + "</div>" +
      '<div class="kv"><span>本视角得分</span><b>' + fmtScore(p.score) + "</b></div>" +
      '<div class="kv"><span>每任务成本</span><b>' + fmtCost(p.cost) + "</b></div>" +
      '<div class="kv"><span>本视角排名</span><b>#' + rank + "</b></div>" +
      '<div class="kv"><span>AA 综合 v5</span><b>' + fmtScore(m.aaIndex) + (aaRank ? " · #" + aaRank : "") + "</b></div>" +
      '<div class="kv"><span>FrontierCode 2.0</span><b>' + fmtScore(m.raw.frontierCode) + "</b></div>" +
      '<div class="kv"><span>Terminal-Bench 4.0</span><b>' + fmtScore(m.raw.terminalBench) + "</b></div>" +
      (delta ? '<div class="badge">相对 AA v5 排名 ' + (delta > 0 ? "↑" + delta : delta < 0 ? "↓" + -delta : "持平") + "</div>" : "");
    moveTooltip(e);
  }
  function moveTooltip(e) {
    const wrap = $(".chart-wrap").getBoundingClientRect();
    let px = e.clientX - wrap.left + 16;
    let py = e.clientY - wrap.top + 16;
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    if (px + tw > wrap.width) px = e.clientX - wrap.left - tw - 16;
    if (py + th > wrap.height) py = e.clientY - wrap.top - th - 16;
    tooltip.style.left = Math.max(4, px) + "px";
    tooltip.style.top = Math.max(4, py) + "px";
  }
  function hideTooltip() {
    tooltip.hidden = true;
    state.hovered = null;
  }

  // ---------- 渲染：读数 ----------
  function renderInsights(view) {
    const { points, frontier, knee, rankScore } = view;
    const cards = [];
    if (knee) {
      const kp = knee.point;
      cards.push({
        cls: "knee",
        label: "性价比膝点",
        name: kp.name,
        meta: "得分 <b>" + fmtScore(kp.score) + "</b> · 每任务 <b>" + fmtCost(kp.cost) + "</b> · 排名 #" + rankScore.get(kp.id),
        foot: "再往上加钱，能力提升开始明显变缓。",
      });
    } else if (points.length) {
      const best = points.reduce((a, b) => (a.score > b.score ? a : b));
      cards.push({ cls: "knee", label: "未检测到明确膝点", name: best.name, meta: "当前筛选下前沿比较直，没有明显拐点。", foot: "" });
    }
    if (points.length) {
      const best = points.reduce((a, b) => (a.score > b.score ? a : b));
      cards.push({
        cls: "",
        label: "能力天花板",
        name: best.name,
        meta: "得分 <b>" + fmtScore(best.score) + "</b> · 每任务 <b>" + fmtCost(best.cost) + "</b> · #" + rankScore.get(best.id),
        foot: knee ? "比膝点多 " + (best.score - knee.point.score).toFixed(1) + " 分，成本是 " + (best.cost / knee.point.cost).toFixed(1) + " 倍。" : "",
      });
      // 接近天花板里最便宜的（≥95% 最高分）
      const near = points.filter((p) => p.score >= best.score * 0.95).sort((a, b) => a.cost - b.cost)[0];
      if (near && near.id !== best.id) {
        cards.push({
          cls: "",
          label: "接近天花板里最便宜",
          name: near.name,
          meta: "得分 <b>" + fmtScore(near.score) + "</b> · 每任务 <b>" + fmtCost(near.cost) + "</b>",
          foot: "拿到天花板 " + Math.round((near.score / best.score) * 100) + "% 的分数，只花 " + Math.round((near.cost / best.cost) * 100) + "% 的钱。",
        });
      }
      const opens = points.filter((p) => p.open);
      if (opens.length) {
        const ob = opens.reduce((a, b) => (a.score > b.score ? a : b));
        cards.push({
          cls: "",
          label: "开源权重最强",
          name: ob.name,
          meta: "得分 <b>" + fmtScore(ob.score) + "</b> · 每任务 <b>" + fmtCost(ob.cost) + "</b>",
          foot: "落后天花板 " + (best.score - ob.score).toFixed(1) + " 分。",
        });
      }
    }
    const box = $("#insightCards");
    box.innerHTML = cards
      .map(
        (c) =>
          '<div class="icard ' + c.cls + '">' +
          '<div class="ic-label">' + c.label + "</div>" +
          '<div class="ic-name">' + c.name + "</div>" +
          '<div class="ic-meta">' + c.meta + "</div>" +
          (c.foot ? '<div class="ic-meta muted" style="margin-top:6px">' + c.foot + "</div>" : "") +
          "</div>"
      )
      .join("");

    // 前沿列表
    const list = $("#frontierList");
    list.innerHTML = "";
    frontier.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = (knee && p.id === knee.point.id ? "knee-row " : "") + (state.pinned === p.id ? "active" : "");
      li.innerHTML = '<span class="idx">' + (i + 1) + '</span><span class="nm">' + shortName(p.name) + '</span><span class="val">' + fmtScore(p.score) + " @ " + fmtCost(p.cost) + "</span>";
      li.onclick = () => { state.pinned = state.pinned === p.id ? null : p.id; renderAll(); };
      list.appendChild(li);
    });
  }

  // ---------- 渲染：表格 ----------
  function renderTable(view) {
    const { rows, rankScore, rankAA, knee } = view;
    const tbody = $("#tableBody");
    tbody.innerHTML = "";
    const val = (r) => (r.score != null && r.cost ? r.score / r.cost : null);
    const keyFn = {
      rank: (r) => rankScore.get(r.model.id) ?? 1e9,
      name: (r) => r.model.name.toLowerCase(),
      score: (r) => r.score ?? -1,
      cost: (r) => r.cost ?? 1e9,
      value: (r) => val(r) ?? -1,
      aaIndex: (r) => r.model.aaIndex ?? -1,
      rankDelta: (r) => {
        const a = rankAA.get(r.model.id), b = rankScore.get(r.model.id);
        return a && b ? a - b : -1e9;
      },
    };
    const sorted = rows.slice().sort((a, b) => {
      const f = keyFn[state.sortKey] || keyFn.score;
      const av = f(a), bv = f(b);
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return state.sortDir === "asc" ? cmp : -cmp;
    });

    for (const r of sorted) {
      const m = r.model;
      const rank = rankScore.get(m.id);
      const aaRank = rankAA.get(m.id);
      const delta = rank && aaRank ? aaRank - rank : null;
      const tr = document.createElement("tr");
      if (knee && m.id === knee.point.id) tr.className = "knee-row";
      const deltaHtml =
        delta == null ? '<span class="muted">—</span>'
          : delta > 0 ? '<span class="up">↑' + delta + "</span>"
          : delta < 0 ? '<span class="down">↓' + -delta + "</span>"
          : '<span class="flat">持平</span>';
      tr.innerHTML =
        '<td class="num">' + (rank ?? "—") + "</td>" +
        '<td><div class="model-cell"><span class="swatch" style="background:' + m.color + '"></span><span>' + m.name + "</span>" +
        (m.isOpenWeights ? '<span class="tag ow">开源</span>' : "") +
        (m.isReasoning ? "" : '<span class="tag">非推理</span>') +
        "</div></td>" +
        '<td class="num">' + fmtScore(r.score) + "</td>" +
        '<td class="num">' + (r.cost == null ? '<span class="muted">无公开价格</span>' : fmtCost(r.cost)) + "</td>" +
        '<td class="num">' + (val(r) == null ? "—" : val(r).toFixed(1)) + "</td>" +
        '<td class="num">' + fmtScore(m.aaIndex) + "</td>" +
        '<td class="num">' + deltaHtml + "</td>";
      tr.onclick = () => { state.pinned = state.pinned === m.id ? null : m.id; renderAll(); };
      tr.style.cursor = "pointer";
      tbody.appendChild(tr);
    }

    document.querySelectorAll("#modelTable thead th").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
        else { state.sortKey = k; state.sortDir = k === "name" || k === "cost" || k === "rank" ? "asc" : "desc"; }
        renderAll();
      };
    });
  }

  // ---------- 文案 ----------
  const TITLES = {
    coding: ["编程能力 vs 每任务成本", "Agentic Coding = FrontierCode 2.0 与 Terminal-Bench 4.0 等权（AA 官方子分数）"],
    coding_eng: ["编程 + 工程能力 vs 每任务成本", "Agentic Coding 60% + Agentic Knowledge Work 40%"],
    aa_eng: ["AA 工程指数 vs 每任务成本", "AA 官方 Engineering Index：知识 30% · 科研 20% · 推理 20% · 编程 15% · 工程协作 15%"],
    aa_v5: ["AA 综合智能 v5 vs 每任务成本", "AA 官方 Intelligence Index v5：知识工作 25% · 编程 25% · 科研 25% · 通用 25%"],
    custom: ["自定义能力组合 vs 每任务成本", "按你调整的权重复合五个能力支柱"],
  };

  function renderCopy(view) {
    const t = TITLES[state.preset] || TITLES.custom;
    $("#chartTitle").textContent = t[0];
    $("#chartSubtitle").textContent = t[1];
    $("#statModels").textContent = view.rows.length;
    $("#statPillars").textContent = view.frontier.length;
    $("#statKnee").textContent = view.knee ? shortName(view.knee.point.name) : "—";
    $("#chartNote").textContent =
      "样本：" + view.points.length + " 个有完整评测的模型；成本按 AA 公开的 token 消耗与标价复算，与官方每任务成本误差 1–3%。" +
      "K2 Horizon 当前标价接近 0，按免费档排除在对数轴外；无公开价格的模型不参与成本比较。";
  }

  // ---------- 总渲染 ----------
  function renderData() {
    const view = buildView();
    renderChart(view);
    renderInsights(view);
    renderTable(view);
    renderCopy(view);
    return view;
  }

  function renderAll() {
    renderPresets();
    renderSliders();
    renderProviders();
    renderData();
  }

  // ---------- 事件 ----------
  $("#openOnly").onchange = (e) => { state.openOnly = e.target.checked; renderAll(); };
  $("#reasoningOnly").onchange = (e) => { state.reasoningOnly = e.target.checked; renderAll(); };
  $("#providerAll").onclick = () => { state.providers = new Set(providerMeta.map((p) => p.slug)); renderAll(); };

  // 时间戳
  const dt = new Date(D.generatedAt);
  const stamp = dt.toLocaleString("zh-CN", { hour12: false });
  $("#syncTime").textContent = "数据同步 " + stamp + " · AA v5 口径";
  $("#footerTime").textContent = "生成于 " + stamp;

  renderAll();
})();
