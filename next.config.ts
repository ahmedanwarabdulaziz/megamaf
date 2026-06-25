import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

// Only enable PWA in production. In development the static sw.js in /public
// would be served and cache stale JS bundles, breaking HMR.
const config =
  process.env.NODE_ENV === "production"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@ducanh2912/next-pwa").default({
        dest: "public",
        register: true,
        skipWaiting: true,
        customWorkerDir: "worker",
      })(nextConfig)
    : nextConfig;

export default config;
