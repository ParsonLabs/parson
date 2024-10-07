"use client"

import "@music/ui/globals.css"
import { Inter as FontSans } from "next/font/google"

import pl from "@/assets/pl-tp.png"
import SettingsSidebar from "@/components/Layout/Settings/Sidebar"
import { cn } from "@music/ui/lib/utils"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import getSession from "@/lib/Authentication/JWT/getSession"
import { useSession } from "@/components/Providers/AuthProvider"

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

type RootLayoutProps = {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  const { session } = useSession()
  const isAdmin = session?.role === "admin"
  const pathname = usePathname()
  const router = useRouter()

  
  useEffect(() => {
    const adminPaths = ["/settings/users/", "/settings/server/", "/settings/library/"]

    if (adminPaths.includes(pathname) && !isAdmin) {
      router.push("/settings")
    }
  }, [pathname, isAdmin, router])

  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased bg-gray-900 texxt-white",
          fontSans.variable
        )}>
          <Link href="/home">
          <div className="flex flex-row text-white items-center font-bold pl-4 pt-3 fixed z-50">
            <Image src={pl} alt="ParsonLabs" height={30} width={30}/>
            <div className="md:text-xl text-white font-bold pl-3">
                ParsonLabs Music
            </div>
          </div>
          </Link>
          <div className="fixed left-0 top-0 h-full w-1/4 flex items-center justify-center">
            <SettingsSidebar />
          </div>
          {children}
      </body>
    </html>
  )
}