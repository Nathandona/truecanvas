import type { NextConfig } from "next";
import { withTruecanvas } from "truecanvas/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
};

export default withTruecanvas(nextConfig);
