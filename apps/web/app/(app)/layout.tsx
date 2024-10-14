import SplashScreen from "@/components/Layout/SplashScreen";
import "@music/ui/globals.css";
import { cn } from "@music/ui/lib/utils";
import { Metadata, Viewport } from "next";
import { Inter as FontSans } from "next/font/google";
import MainLayout from "./main-layout";

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
          "min-h-screen bg-background font-sans antialiased bg-gray-900 texxt-white",
          fontSans.variable
        )}>
        <MainLayout>
          {children}
        </MainLayout>
      </body>
    </html>
  );
}