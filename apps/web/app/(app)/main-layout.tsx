import "@music/ui/globals.css"

import { cn } from "@music/ui/lib/utils"
import { Toaster } from "sonner"
import { Metadata, Viewport } from "next"
import NavBar from "@/components/Layout/Navbar"
import Player from "@/components/Music/Player"
import Providers from "@/components/Providers/Providers"
import Sidebar from "@/components/Layout/Sidebar"
import QueuePanel from "@/components/Music/Queue/QueuePanel"
import LyricsOverlay from "@/components/Lyrics/LyricsOverlay"
import { Suspense } from "react"
import FriendActivity from "@/components/Friends/FriendActivity"
import Playlists from "@/components/Layout/Playlists"
import { Separator } from "@music/ui/components/separator"
import TopGradient from "@/components/Layout/TopGradient"
import AIPanel from "@/components/AI/AIPanel"
import { Inter } from "next/font/google"

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

export default function MainLayout({ children }: any) {
  return (
    <div
      className={cn(
        "min-h-screen font-sans antialiased bg-black text-white",
        fontSans.variable
      )}
    >
      <Providers>
        <TopGradient />
        <div className="fixed top-0 left-0 z-50 w-full">
          <NavBar />
        </div>

        <Sidebar
          sidebarContent={
            <>
              {/* <Separator className="bg-gray-800" /> */}
              <Suspense>
                <FriendActivity />
              </Suspense>

              <Suspense>
                <Playlists />
              </Suspense>
            </>
          }
        >
          <QueuePanel>
            <LyricsOverlay>
              <AIPanel>
                {children}
              </AIPanel>
            </LyricsOverlay>
          </QueuePanel>
        </Sidebar>

        <Player />
        <Toaster theme="dark" />
      </Providers>
    </div>
  );
}