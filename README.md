# Parallax · CodePareto 分支

**在线站点：<https://x-mug.github.io/code-pareto/>**（数据每 12 小时自动重建）

本项目是 [cr-zhichen/parallax](https://github.com/cr-zhichen/parallax)（MIT）的 fork：
**界面、交互、五语 i18n、主题、ECharts 图表行为与原版保持一致**，并叠加了"只关心编程/工程能力"的视角。

## 与原版的差异

| 增量 | 说明 |
| --- | --- |
| 视角切换 | 综合智能 / 纯编程 / 编程+工程 / AA 工程指数 / 自定义 |
| 自定义权重 | 5 支能力支柱滑块（Agentic Coding、Knowledge Work、Science、Reasoning、Knowledge） |
| 开源权重筛选 | 只看开放权重模型 |
| 膝点高亮 | 散点图环状标记 + 推荐首卡徽章 |
| 完整名单表格 | 可排序，含每美元得分、AA 综合 v5 排名变化 |

## 数据

- 模型目录：Artificial Analysis（经公开快照接口）
- 编程/工程子分数：AA Engineering Index 页面的 5 支子分数
- 每任务成本：用 AA 公开的评测 token 消耗 × 官方价格复算，与官方口径误差 1–3%
- 只有 AA 完整跑完 9 项评测的 28 个模型有编程/工程维度

```bash
node scripts/build-data.mjs
node scripts/check-data.mjs
```

## 开发与构建

```bash
npm install
npx next dev
NEXT_PUBLIC_BASE_PATH=/code-pareto npx next build   # 静态导出到 out/
node scripts/parity-check.mjs                       # 与原版线上做结构级比对
```

## 部署

推送到 main 后由 GitHub Actions 生成数据、静态构建并发布到 GitHub Pages。

## 许可

原项目 MIT，版权归 Copyright (c) 2026 zgccrui；本 fork 同样以 MIT 发布，详见 LICENSE 与 NOTICE。
