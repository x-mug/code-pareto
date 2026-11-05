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
| 对照轴切换 | 「能力 / 价格」与「能力 / 速度」两个页签；速度轴横轴换成输出速度（tokens/秒），帕累托前沿与膝点按速度重算 |
| 完整名单表格 | 可排序，含输出速度、每美元得分、AA 综合 v5 排名变化 |
| 可分享链接 | 视角、自定义权重、开源筛选、选中模型、对照轴写进地址栏，一条链接复现同一个决策视图 |

### 可分享链接

状态变化会同步到地址栏，只写偏离默认值的参数，默认访问时地址栏一个字符都不变：

```
?view=custom&open=1&m=<model-id>&w=coding:60,akw:40&axis=speed
```

| 参数 | 含义 |
| --- | --- |
| `view` | `intelligence` / `coding` / `codingEngineering` / `aaEngineering` / `custom` |
| `open` | `1` 表示只看开源权重模型 |
| `m` | 选中的模型 id |
| `w` | 自定义权重，百分比写法，只有 custom 视角且偏离默认时才写 |
| `axis` | `speed` 表示能力 / 速度对照轴；默认价格轴时不写 |

任何非法参数都会静默回落到默认值，不会让页面报错。

## 数据

- 模型目录：Parallax 公开快照，补充 AA 发布列表和 Intelligence Index 中已有真实身份的模型
- 编程/工程子分数：AA Engineering Index 页面的 5 支子分数
- 每任务成本：用 AA 公开的评测 token 消耗 × 官方价格复算，与官方口径误差 1–3%
- 输出速度与首字延迟来自 AA 的实测数据，82 个可比较模型里 81 个有速度值
- 只有 AA 完整跑完 9 项评测的 28 个模型有编程/工程维度

```bash
npm run data:build   # 从 AA 拉数据生成 src/data/catalog.json
npm run data:check   # 校验数据契约、支柱完整性、成本反算一致性
```

AA 补充发现以其发布列表公开返回的模型为范围，排行榜也用于补充指标和降级；这不代表覆盖全网所有新模型。新 slug 会查询对应的 AA 模型详情，只有取得真实模型 id 和基础身份后才收录。价格、速度或成本没有可靠数据时保持空值；详情缺失时会告警并在下次重试。

AA 补充模型保留其 AA 身份，Parallax 后续收录时采用 Parallax 的数据并保持站内 id，避免历史记录和分享链接失效。仅在发布列表找到旧模型、但本轮无法获取其最新指标时，会保留上次记录并标记 `aaStale`；已收录但未进入完整 Intelligence 列表的模型会继续查询详情。发现新指标或由 Parallax 接管后清除过期标记；本轮缺失的价格和性能指标保持空值。发布列表或排行榜不可用时会告警并使用其他来源；Engineering 页面整体不可用时会停止更新。

AA Intelligence 页标题的指数主版本必须与目录一致，AA 补充模型的综合能力分才能进入同口径比较；版本不一致或无法确认时保留模型并置空综合分。没有工程评测或成本数据的模型仍可收录，但不会凭空生成缺失指标。

### 模型近期变更记录

`data:build` 同时维护 `src/data/recent-model-updates.json`：按模型 id 比较新旧目录，记录新收录模型，以及综合能力、每任务成本、输入价格和输出价格的有效变化。新收录事件列出发现时已有的非空指标；变更事件保留变化前后的原始数值。速度和首字延迟不参与比较，避免短期波动淹没其他变化。

`observedAt` 是本站发现变化的时间，不是模型发布日期或数据源更新时间。已有历史从 `origin/main` 的目录提交重建，以最早可用目录作为基线，后续事件使用各次目录提交的提交时间；之后每次刷新使用本次生成时间。缺少旧目录时只建立基线并保留已有记录，不把整个新目录误认为新收录。

数字比较时综合能力保留 1 位小数，每任务成本小于 0.1 美元时保留 3 位、其余保留 2 位，输入和输出价格保留 4 位；空值与零的变化仍会记录。记录按发现时间倒序排列，最多保留 500 条；没有相关变化时原记录保持不变。写入前会校验输入并准备文件，普通写入错误会尝试恢复原目录和记录。GitHub Actions 会将目录和变更记录一同提交。

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
