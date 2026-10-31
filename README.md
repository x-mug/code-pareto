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
| 可分享链接 | 视角、自定义权重、开源筛选、选中模型写进地址栏，一条链接复现同一个决策视图 |

### 可分享链接

状态变化会同步到地址栏，只写偏离默认值的参数，默认访问时地址栏一个字符都不变：

```
?view=custom&open=1&m=<model-id>&w=coding:60,akw:40
```

| 参数 | 含义 |
| --- | --- |
| `view` | `intelligence` / `coding` / `codingEngineering` / `aaEngineering` / `custom` |
| `open` | `1` 表示只看开源权重模型 |
| `m` | 选中的模型 id |
| `w` | 自定义权重，百分比写法，只有 custom 视角且偏离默认时才写 |

任何非法参数都会静默回落到默认值，不会让页面报错。

## 数据

- 模型目录：Artificial Analysis（经公开快照接口）
- 编程/工程子分数：AA Engineering Index 页面的 5 支子分数
- 每任务成本：用 AA 公开的评测 token 消耗 × 官方价格复算，与官方口径误差 1–3%
- 只有 AA 完整跑完 9 项评测的 28 个模型有编程/工程维度

```bash
npm run data:build   # 从 AA 拉数据生成 src/data/catalog.json
npm run data:check   # 校验数据契约、支柱完整性、成本反算一致性
```

## 开发与构建

统一用 npm，仓库只保留 `package-lock.json` 一份锁文件。

```bash
npm ci               # 安装依赖
npm run dev          # 本地开发

npm run build        # 静态导出到 out/，已内置 basePath=/code-pareto
npm run start        # 本地预览（非静态产物场景）
```

## 质量门禁

`npm run check` 串起全部校验，任一项失败即中断：

| 命令 | 内容 |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest 单测（视角/膝点/替代关系/i18n/URL 状态） |
| `npm run data:check` | 数据契约与管线预期 |
| `npm run build` | 静态导出，顺带跑一次 TypeScript |
| `npm run ui:test` | 对 `out/` 真跑一遍：起静态服务 + jsdom 水合，断言视角切换、权重拖拽、开源筛选、排序、链接状态 |
| `npm run parity:check` | 与上游线上站做结构级 class 比对（需外网，不在 CI 里） |

`ui:test` 的期望值全部从 `src/data/catalog.json` 推导，数据刷新不会打断测试；但 `out/` 必须与当前源码同批构建，改了 `src/` 要先 `npm run build`。

## 部署

推送到 main 后由 GitHub Actions 依次执行：生成数据 → 数据校验 → lint → typecheck → 单测 → 静态构建 → UI 测试 → 发布到 GitHub Pages。
任一环节失败都不会上线，只有产物全部通过才会部署。

## 许可

原项目 MIT，版权归 Copyright (c) 2026 zgccrui；本 fork 同样以 MIT 发布，详见 LICENSE 与 NOTICE。
