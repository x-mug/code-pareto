import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

// 受限沙箱里 next build 无法 spawn 子进程，打开该开关把 build worker 切到 worker_threads。
const useWorkerThreads = process.env.NEXT_BUILD_WORKER_THREADS === "1";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["**.*"],
  output: "export",
  basePath,
  ...(basePath ? { assetPrefix: basePath } : {}),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["echarts", "zrender"],
  ...(useWorkerThreads ? { experimental: { workerThreads: true } } : {}),
};

export default nextConfig;
