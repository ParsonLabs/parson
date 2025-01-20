import "@music/ui/globals.css";
import { Inter as FontSans } from "next/font/google";
import { Metadata, Viewport } from "next";
import SplashScreen from "@/components/Layout/SplashScreen";
import { cn } from "@music/ui/lib/utils";
import AuthProvider from "@/components/Providers/AuthProvider";

export const metadata: Metadata = {
  applicationName: "ParsonLabs Music",
  title: {
    default: "ParsonLabs Music",
    template: "%s | ParsonLabs Music",
  },
  description: "Own your music.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ParsonLabs Music",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    title: {
      default: "ParsonLabs Music",
      template: "%s | ParsonLabs Music",
    },
    description: "Own your music.",
  },
};

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default async function RootLayout({ children }: any) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className={cn(
          "min-h-screen bg-background font-sans antialiased bg-zinc-950 texxt-white",
          fontSans.variable
        )}>
        <AuthProvider>
          <SplashScreen>
            {children}
          </SplashScreen>
        </AuthProvider>
      </body>
    </html>
  );
}