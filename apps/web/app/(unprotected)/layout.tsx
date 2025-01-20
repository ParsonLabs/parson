import "@music/ui/globals.css"
import { Inter as FontSans } from "next/font/google"

import pl from "@/assets/pl-tp.png"
import { cn } from "@music/ui/lib/utils"
import { Metadata } from "next"
import Image from "next/image"

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

type RootLayoutProps = {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased bg-zinc-950",
          fontSans.variable
        )}>
          <div className="flex flex-row text-white items-center font-bold pl-4 pt-3 fixed">
            <Image src={pl} alt="ParsonLabs" height={30} width={30} priority />
            <div className="md:text-xl text-white font-bold pl-3">
              ParsonLabs Music
            </div>
          </div>

        {children}
      </body>
    </html>
  )
}
