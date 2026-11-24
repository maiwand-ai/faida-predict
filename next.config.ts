import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // Type errors fail the build: shipping code that doesn't typecheck is how
  // runtime crashes reach production. (`npm run typecheck` runs the same check.)
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
};

export default nextConfig;
