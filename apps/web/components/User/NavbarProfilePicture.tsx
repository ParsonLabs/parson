"use client"

import {
  LogOut,
  Settings,
  User,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@music/ui/components/dropdown-menu"

import {
  Dialog,
  DialogTrigger,
} from "@music/ui/components/dialog"
 
import { Avatar, AvatarFallback, AvatarImage } from "@music/ui/components/avatar"
import Link from "next/link"
import SettingsDialog from "./SettingsDialog"

import getSession from "@/lib/Authentication/JWT/getSession"
import { getProfilePicture } from "@music/sdk"
import { deleteCookie } from "cookies-next"
import { Inter as FontSans } from "next/font/google"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "@music/ui/lib/utils"

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
})

export default function NavbarProfilePicture() {
  const [username, setUsername] = useState("")
  const [profilePicture, setProfilePicture] = useState<string | null>(null)

  useEffect(() => {
    const fetchSessionAndProfilePicture = async () => {
      const session = getSession()
      if (session) {
        setUsername(session.username)
        const profilePic = await getProfilePicture(Number(session.sub))
        if (profilePic) {
          setProfilePicture(URL.createObjectURL(profilePic))
        } else {
          setProfilePicture(null)
        }
      }
    }
    fetchSessionAndProfilePicture()
  }, [])

  const { push } = useRouter()
  function signOut() {
    deleteCookie("music_jwt")
    push("/login")
  }
  
  function removeServer() {
    localStorage.removeItem("server")
    push("/")
  }

  return (
    <Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="mr-4 cursor-pointer">
            {profilePicture ? (
              <AvatarImage src={profilePicture} alt="User Profile Picture" className="bg-gray-600" />
            ) : (
              <AvatarFallback>{username.substring(0, 2).toUpperCase()}</AvatarFallback>
            )}
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <Link href={`/profile?username=${username}`}>
              <DropdownMenuItem>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile</span>
              </DropdownMenuItem>
            </Link>

            <Link href={`/settings`}>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Settings</span>
              </DropdownMenuItem>
            </Link>
          </DropdownMenuGroup>

          <DropdownMenuSeparator/>
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
            <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => removeServer()}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Change Server</span>
            <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SettingsDialog />
    </Dialog>
  )
}