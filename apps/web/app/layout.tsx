import "./globals.css";

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import SessionProvider from "@/features/account/session-provider";
import AppBootstrap from "@/components/app/splash-screen";

import { Toaster } from "sonner";
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://parson.dev",
  ),
  applicationName: "Parson",
  title: "Parson",
  description: "Own your music.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Parson",
    description: "Own your music.",
    images: [{ url: "/images/og/parson.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Parson",
    description: "Own your music.",
    images: ["/images/og/parson.jpg"],
  },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.className} min-h-screen bg-black text-white antialiased`}
      >
        <SessionProvider>
          <AppBootstrap>{children}</AppBootstrap>
          <Toaster
            closeButton={false}
            position="bottom-right"
            theme="dark"
            toastOptions={{
              classNames: {
                toast: "!border-white/10 !bg-black !text-white !shadow-2xl",
                description: "!text-zinc-400",
                actionButton: "!bg-white !text-black",
                cancelButton: "!bg-zinc-900 !text-white",
              },
            }}
          />
        </SessionProvider>
      </body>
    </html>
  );
}
