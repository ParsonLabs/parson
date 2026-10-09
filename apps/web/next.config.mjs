import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  devIndicators: { position: "bottom-right" },
  transpilePackages: ["@parson/music-sdk"],
  experimental: { useTypeScriptCli: true },
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: "http", hostname: "**" }],
  },
  webpack(config) {
    config.resolve.alias["@"] = fileURLToPath(new URL(".", import.meta.url));
    return config;
  },
};

export default nextConfig;
