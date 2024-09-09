import withPWAInit from "@ducanh2912/next-pwa"

const withPWA = withPWAInit({
  dest: "public"
})

/** @type {import('next').NextConfig} */
const nextConfig = withPWA({
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@music/sdk"],
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        hostname: "localhost"
      }
    ]
  },
});

export default nextConfig;