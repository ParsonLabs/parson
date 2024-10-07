import { useSession } from "@/components/Providers/AuthProvider"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"

export default function SettingsAuth() {
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

  return <></>
}