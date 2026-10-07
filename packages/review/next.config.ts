import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // review links are private: never indexed
  // the studio's icon in browser tabs
  async redirects() {
    return process.env.BRAND_LOGO ? [{ source: "/favicon.ico", destination: process.env.BRAND_LOGO, permanent: false }] : [];
  },
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
