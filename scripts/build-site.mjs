#!/usr/bin/env node
// 静态导出构建入口：固定 GitHub Pages 项目页所需的 basePath，跨平台不需要额外 shell。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/code-pareto";
const NEXT_BIN = path.resolve("node_modules/next/dist/bin/next");

if (!existsSync(NEXT_BIN)) {
  console.error("找不到 next：" + NEXT_BIN + "（先在仓库根目录跑 npm install）");
  process.exit(1);
}

const child = spawn(process.execPath, [NEXT_BIN, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

child.on("error", (error) => {
  console.error("启动 next build 失败：" + error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error("next build 被信号中断：" + signal);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
