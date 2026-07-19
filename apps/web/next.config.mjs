import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  transpilePackages: ["@parson/music-sdk"],
  // TypeScript 7 is checked separately because Next still imports its removed JS API.
  typescript: { ignoreBuildErrors: true },
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
