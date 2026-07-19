import { createMDX } from "fumadocs-mdx/next";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  webpack(webpackConfig) {
    // Webpack cannot statically trace Fumadocs' generated file-URL imports.
    webpackConfig.infrastructureLogging = { level: "error" };
    return webpackConfig;
  },
  async rewrites() {
    return [
      {
        source: "/docs/:path*.md",
        destination: "/llms.mdx/docs/:path*",
      },
    ];
  },
};

export default createMDX()(config);
