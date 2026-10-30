# CodePareto · 编程与工程视角的模型版图

> 把科研从评分里拿掉，只看成本和编程/工程能力的曲线，并自动标出性价比膝点。
>
> 在线版：<https://x-mug.github.io/code-pareto/>　数据每 12 小时由 GitHub Actions 自动同步。

打开方式：双击 `index.html`（纯静态，无需服务器）。

---

## 这个页面解决什么问题

Artificial Analysis 的 Intelligence Index v5（2026-10-27 发布）四个大类各占 25%：

| 类别 | 权重 | 评测 |
| --- | --- | --- |
| Knowledge Work | 25% | AA-Briefcase 15% · AutomationBench-AA 5% · GDP.pdf 5% |
| Coding | 25% | FrontierCode 2.0 15% · Terminal-Bench 4.0 10% |
| Science | 25% | Terminal-Bench-Science 15% · CritPt v2 (Hard) 10% |
| General | 25% | AA-Omniscience v1.1 15% · HLE-Diamond 10% |

也就是说：**纯软件工程（FrontierCode 2.0）只占 15%**，而科研 25% + 通用知识/推理 25% 占了半边天。
AA 也没有模型级的 Coding Index（只有 Agent 级的 Coding Agent Index），单个评测页面各看各的。

本页把 AA 公开的五支能力子分数重新组合，只保留编程与工程相关的维度，
在「每任务成本 × 能力得分」平面上画帕累托前沿，并算出膝点。

## 五个能力支柱（0–100，直接取自 AA Engineering Index 页面的子分数）

| 支柱 | 来源 | 说明 |
| --- | --- | --- |
| Agentic Coding | FrontierCode 2.0 + Terminal-Bench 4.0 等权 | 编程/终端工程，**默认视角只看这一支** |
| Agentic Knowledge Work | AA-Briefcase v1.1 | 长任务工程协作（交付物、表格、文档） |
| Science | CritPt v2 Hard + Terminal-Bench-Science | 科研 |
| Reasoning | HLE-Diamond | 通用推理 |
| Knowledge | AA-Omniscience + GDP.pdf + AutomationBench | 领域知识与长文档 |

## 四个预设视角

| 视角 | 权重 |
| --- | --- |
| 纯编程 | Agentic Coding 100% |
| 编程 + 工程 | Coding 60% + Knowledge Work 40% |
| AA 工程指数 | 知识 30 · 科研 20 · 推理 20 · 编程 15 · 工程协作 15（= AA 官方 Engineering Index，可用来对照它自带多少科研） |
| AA 综合 v5 | AA 官方 Intelligence Index v5 与官方每任务成本 |

拖任意滑块即进入「自定义」：比如把科研、推理、知识全部拉 0，就是纯编程工程视角。

## 数据怎么来的

- 抓取页面：`/evaluations/artificial-analysis-intelligence-index`（9 项评测原始分、token 消耗、价格）与 `/indexes/engineering`（五支子分数、官方成本）。
- AA 是 Next.js 应用，模型数据塞在 RSC 流里；`scripts/sync.mjs` 用正则抓 `initialModels` 数组后解析，不依赖任何第三方 API。
- 成本复算：AA 的 cost-per-task 定义是「每项评测的 token 成本 ÷ 任务数 × 该评测权重」。
  token 成本 = 非缓存输入 × 输入价 + 缓存读 × 缓存价 + 缓存写 × 写价 + (answer + reasoning) × 输出价。
  与 AA 自己公布的综合每任务成本比对，误差 1–3%。
- 样本：AA 完整跑完 9 项评测的 28 个模型（`28 of 86 models`，AA 自己的覆盖率）。

刷新数据：

```bash
cd aa-code-landscape
node scripts/sync.mjs     # 重新抓 AA 页面并写入 data.js
```

## 膝点算法

1. 取帕累托前沿：成本升序、得分严格递增的点（同样价格下没有更强的模型）。
2. 在 `(log10(成本), 得分)` 归一化平面上，取前沿首尾连线，找离这条线最远的点 —— 即 Kneedle 思路，
   也就是「再往上加钱、能力提升开始变缓」的拐点。
3. 成本 ≤ $0.01 的免费/促销档（K2 Horizon）不进对数轴，否则会把整条曲线压扁。

## 文件结构

```
aa-code-landscape/
├─ scripts/
│  ├─ sync.mjs       抓取 AA 并生成 data.js
│  ├─ verify-core.cjs  校验前沿/膝点
│  ├─ check-knee.cjs   各视角膝点明细
│  ├─ stats.cjs        排名变化统计
│  ├─ smoke.cjs        jsdom 冒烟测试（需 .devtools 里的 jsdom）
│  └─ geometry.cjs     SVG 几何越界/重叠检查
└─（跑冒烟测试需要 jsdom：`npm i jsdom`，仅测试用）
```

## 已知边界

- 只有 AA 完整评测过的 28 个模型；不是全市场。
- 成本按官方标价与 AA 的 token 统计估算，实际账单受缓存率、批量折扣影响。
- 子分数由 AA 定义，本页只做再加权，不产出新数据；评分与成本原始值版权归 Artificial Analysis。
- Muse Wonder Full 没有公开价格，不参与成本轴比较。

## 参考

- [Intelligence Index v5 公告](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5)
- [Engineering Index](https://artificialanalysis.ai/indexes/engineering)
- [FrontierCode 2.0](https://artificialanalysis.ai/evaluations/frontiercode-2-0)（自带 Pareto line，但没有膝点）
- [Coding Agent Index](https://artificialanalysis.ai/agents/coding-agents)（Agent 级编码复合榜）
