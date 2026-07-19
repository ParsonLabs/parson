import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://docs.parson.dev",
  ),
  title: { default: "Parson Docs", template: "%s · Parson Docs" },
  description:
    "Practical documentation for Parson, the local-first music server and player.",
  applicationName: "Parson Docs",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "Parson Docs",
    description: "Practical documentation for your Parson music library.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#090909",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen antialiased`}>
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
