import "@music/ui/globals.css"
import { Inter as FontSans } from "next/font/google"

import pl from "@/assets/pl-tp.png"
import { cn } from "@music/ui/lib/utils"
import { Metadata } from "next"
import Image from "next/image"
import AdminPanelLayout from "@/components/Layout/Sidebar/AdminPanellayout"

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

export const metadata: Metadata = {
  title: "ParsonLabs Music"
}

type RootLayoutProps = {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased ",
          fontSans.variable
        )}>
          <AdminPanelLayout>
            {children}
          </AdminPanelLayout>
      </body>
    </html>
  )
}


