import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  compress: true,          // gzip all HTTP responses in production
  poweredByHeader: false,  // remove X-Powered-By: Next.js header
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  register: true,
  disable: process.env.NODE_ENV !== "production",
});

export default withSerwist(nextConfig);
