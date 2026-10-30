# CodePareto × Parallax 移植规格书

## 0. 目标

以 MIT 许可的 [cr-zhichen/parallax](https://github.com/cr-zhichen/parallax) 源码为底座 fork，
**界面、交互、i18n、主题、图表行为 1:1 保留**；在此基础上叠加"只关心编程/工程"的视角、自定义权重、
膝点高亮、开源权重筛选、完整名单表格。最终静态导出部署到 GitHub Pages。

原则：**默认视角（intelligence）必须和原版逐像素一致**；新增功能只能"加"，不能改原版观感与行为。

## 1. 技术底座

- Next.js 16.2.12 + React 19.2.8 + ECharts 6（SVG renderer）+ lucide-react + KaTeX
- 源仓库路径：`parallax-code/`（原始副本在 `parallax-src/parallax-main/` 供 diff）
- 构建：`next build`，改造为 `output: "export"` 静态导出
- 部署：GitHub Pages 项目页 → https://x-mug.github.io/code-pareto/ ，`basePath=/code-pareto`

## 2. 必须 100% 保留的原版功能（验收清单）

| # | 功能 | 位置 |
|---|---|---|
| 1 | 顶栏：品牌、GitHub 链接、语言下拉（5 语）、主题切换（system/light/dark）、更新时间 | `model-explorer.tsx` 头部 |
| 2 | Hero：eyebrow、主标题、描述、三格统计（全部模型 / 可比较 / 厂商数） | `hero` section |
| 3 | 数据源异常通知条 | `notice-bar` |
| 4 | Explorer：区块标题/描述、模型搜索（名称/厂商/ID、键盘上下、发布日期） | `ModelSearch` |
| 5 | 厂商图例筛选（ALL + 每厂商计数 + 形状/颜色标记） | `creator-legend` |
| 6 | 膝点推荐列表（5 条）+ 公式说明（KaTeX tooltip） | `recommendations` |
| 7 | ECharts 散点：帕累托前沿线、严格替代标记、推理等级连线、hover tooltip、点选 | `model-scatter-plot.tsx` |
| 8 | 图表开关：显示全部标签、对数/线性横轴 | `chart-card__actions` |
| 9 | 决策面板：选中模型指标网格、严格替代、均衡替代、是否在前沿 | `decision-panel` |
| 10 | 五语 i18n（zh-CN / zh-TW / en / ja / ko）、主题持久化、响应式、aria | 全局 |
| 11 | 空状态、loading、footer 来源与 tagline | 各处 |

## 3. 新增功能（叠加，不改原版默认行为）

| # | 功能 | 交互 |
|---|---|---|
| A | 视角切换：综合智能 / 纯编程 / 编程+工程 / AA 工程指数 / 自定义 | 图例 chip 风格按钮组，默认"综合智能" |
| B | 自定义权重：5 支能力支柱滑块，拖动即切到自定义视角 | 权重同时作用于得分与每任务成本 |
| C | 开源权重筛选 | chip 开关，过滤散点/推荐/表格 |
| D | 膝点高亮 | 散点图上环状标记 + 推荐首卡徽章 + 图表图例项 |
| E | 完整名单表格 | 可排序：得分、成本、每美元得分、AA 综合 v5、排名变化；膝点行高亮 |
| F | 视角数据子集提示 | 编程/工程视角只覆盖 AA 完整评测的 28 个模型时提示 |

## 4. 数据契约

`src/data/catalog.json` 结构 = `ModelCatalog`（`src/lib/models.ts`），新增字段：

```ts
interface ModelPoint {
  // ...原有字段不动
  dimensions?: {
    pillars: { coding; akw; science; reasoning; knowledge } | null;   // 0-100，AA 官方子分数
    pillarCosts: { coding; akw; science; reasoning; knowledge } | null; // USD / 任务
    openWeights: boolean | null;
  } | null;
}
```

- 综合视角：直接使用原有 `intelligence` / `costPerTask`（来自 AA 免费 API 快照，与 Parallax 原版一致）
- 编程/工程视角：`applyView()` 把 `intelligence/costPerTask` 替换为支柱加权结果，其余逻辑零改动复用
- 三个数据源：`parallax.zzz.sd/api/models`（718 模型目录）、AA Intelligence Index v5 页面（9 项评测原始分 + token + 价格）、AA Engineering Index 页面（5 支子分数）
- 只有 AA 完整评测的 28 个模型有 `dimensions`；`openWeights` 来自 AA payload `isOpenWeights`

## 5. 文件所有权（禁止越界写）

| 负责人 | 文件 |
|---|---|
| Lead | `src/lib/models.ts`、`src/lib/view-logic.ts`、`SPEC.md`、`package.json`、最终集成与构建 |
| data-pipeline | `scripts/build-data.mjs`、`scripts/check-data.mjs`、`src/data/catalog.json` |
| explorer-ui | `src/components/model-explorer.tsx`、`src/components/model-table.tsx`（新建）、`src/app/globals.css`（只在文件末尾追加） |
| chart-knee | `src/components/model-scatter-plot.tsx` |
| i18n | `src/lib/i18n.ts` |
| static-export | `next.config.ts`、`src/app/page.tsx`、删除 `src/lib/artificial-analysis.ts` 等 server-only 模块、`src/app/api/**`、`.github/workflows/**`、`.gitignore`、`public/.nojekyll` |

**任何人不得**执行 `npm install`、`next build`、`next dev`（Lead 与 static-export 统一跑构建）。

## 6. 组件契约

```ts
// model-scatter-plot.tsx 新增 props（其余不变）
interface ModelScatterPlotProps {
  // ...原有
  kneeIds?: string[];            // 膝点高亮，默认 []
  scoreLabelKey?: string;        // y 轴/提示里的得分文案，默认 "metric.intelligence"
  costLabelKey?: string;         // 默认 "metric.taskCost"
}

// model-table.tsx
interface ModelTableProps {
  models: ModelPoint[];          // 已按视角转换后的列表
  officialModels: ModelPoint[];  // 原始 catalog.models，用于取 AA 综合 v5 与排名
  kneeIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}
```

## 7. 新增 i18n key（5 语言都要有）

```
view.label                  "视角"
view.chip.intelligence      "综合智能"
view.chip.coding            "纯编程"
view.chip.codingEngineering "编程 + 工程"
view.chip.aaEngineering     "AA 工程指数"
view.chip.custom            "自定义"
view.hint.intelligence      "AA 官方 Intelligence Index v5：知识工作 25% · 编程 25% · 科研 25% · 通用 25%。"
view.hint.coding            "只看 Agentic Coding：FrontierCode 2.0 与 Terminal-Bench 4.0 等权。"
view.hint.codingEngineering "Agentic Coding 60% + Agentic Knowledge Work 40%。"
view.hint.aaEngineering     "AA 官方 Engineering Index：知识 30% · 科研 20% · 推理 20% · 编程 15% · 协作 15%。"
view.hint.custom            "自定义权重，同时作用于得分与每任务成本。"
view.weights.title          "能力支柱权重"
view.weights.reset          "重置"
view.pillar.coding          "Agentic Coding"
view.pillar.akw             "Agentic Knowledge Work"
view.pillar.science         "Science"
view.pillar.reasoning       "Reasoning"
view.pillar.knowledge       "Knowledge"
view.openWeights            "仅开源权重"
view.kneeBadge              "膝点"
view.subsetNotice           "该视角只覆盖 AA 完整评测的 {count} 个模型。"
chart.knee                  "膝点"
chart.axis.codingScore      "编程得分"
chart.axis.taskCost         "每任务成本（USD，对数刻度）"
table.title                 "完整名单"
table.subtitle              "得分与成本按当前视角实时计算"
table.rank                  "#"
table.model                 "模型"
table.score                 "本视角得分"
table.cost                  "每任务成本"
table.value                 "每美元得分"
table.aaIndex               "AA 综合 v5"
table.rankDelta             "排名变化"
table.empty                 "当前筛选下没有可比模型"
stats.viewComparable        "本视角可比"
```

## 8. 构建与部署

```bash
# 本地
node scripts/build-data.mjs
NEXT_PUBLIC_BASE_PATH=/code-pareto npx next build   # 产出 out/
node scripts/parity-check.mjs                       # 与原版线上 DOM 做结构比对
```

GitHub Actions：push main → 生成数据 → build → 上传 `out/` → deploy-pages。

## 9. 验收

1. `npx tsc --noEmit` 通过
2. `next build` 通过，`out/index.html` 含完整首屏结构
3. 默认视角下，页面上原版 11 类功能全部可见可用
4. 五个视角切换后：散点、前沿、推荐、替代、表格全部联动
5. 五语切换无缺 key（UI 不出现原始 key）
6. `parity-check.mjs` 报告原版关键 class 覆盖率 100%
