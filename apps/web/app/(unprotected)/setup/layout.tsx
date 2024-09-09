"use client"

import "@music/ui/globals.css"
import { Inter as FontSans } from "next/font/google"

import pl from "@/assets/pl-tp.png"
import { cn } from "@music/ui/lib/utils"
import Image from "next/image"
import { getServerInfo } from "@music/sdk"
import { ServerInfo } from "@music/sdk/types"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"


const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

type RootLayoutProps = {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const router = useRouter()

  useEffect(() => {
    const fetchServerInfo = async () => {
      const info = await getServerInfo();
      setServerInfo(info);
    };

    fetchServerInfo();
  }, []);

  if (!serverInfo || !serverInfo.startup_wizard_completed) {
    return (
      <html lang="en" suppressHydrationWarning>
        <head />
        <body
          className={cn(
            "min-h-screen bg-background font-sans antialiased bg-gray-900",
            fontSans.variable
          )}
        >
          <div className="flex flex-row text-white items-center font-bold pl-4 pt-3 fixed">
            <Image src={pl} alt="ParsonLabs" height={30} width={30} />
            <div className="md:text-xl text-white font-bold pl-3">
              ParsonLabs Music
            </div>
          </div>
          {children}
        </body>
      </html>
    );
  }

  return router.push("/home");;
}