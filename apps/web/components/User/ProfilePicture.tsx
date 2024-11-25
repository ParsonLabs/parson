import { getProfilePicture } from "@music/sdk"
import { Avatar, AvatarFallback, AvatarImage } from "@music/ui/components/avatar"
import { useEffect, useState } from "react"
import { useSession } from "../Providers/AuthProvider"

export default function ProfilePicture() {
  const [profilePicture, setProfilePicture] = useState<string | null>(null)
  const { session } = useSession()

  useEffect(() => {
    const fetchSessionAndProfilePicture = async () => {
      if (session) {
        const profilePic = await getProfilePicture(Number(session.sub))
        if (profilePic) {
          setProfilePicture(URL.createObjectURL(profilePic))
        } else {
          setProfilePicture(null)
        }
      }
    }
    fetchSessionAndProfilePicture()
  }, [session])

  return (
    <Avatar className="mr-4 cursor-pointer scale-150">
      {profilePicture ? (
        <AvatarImage src={profilePicture} alt="User Profile Picture" className="bg-gray-600" />
      ) : (
          <AvatarFallback>{session?.username.substring(0, 2).toUpperCase()}</AvatarFallback>
        )}
    </Avatar>
  )
}