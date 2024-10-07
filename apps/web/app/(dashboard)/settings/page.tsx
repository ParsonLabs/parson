"use client"

import ChangeBitrate from "@/components/User/ChangeBitrate"
import { ChangePassword } from "@/components/User/ChangePassword"
import getSession from "@/lib/Authentication/JWT/getSession"
import { zodResolver } from "@hookform/resolvers/zod"
import { uploadProfilePicture, getProfilePicture } from "@music/sdk"
import { Button } from "@music/ui/components/button"
import Image from "next/image"
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form"
import { Input } from "@music/ui/components/input"
import { Avatar, AvatarImage, AvatarFallback } from "@radix-ui/react-avatar"
import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useSession } from "@/components/Providers/AuthProvider"

const FormSchema = z.object({
  picture: z.instanceof(File).optional(),
})

export default function SettingsPage() {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      picture: undefined,
    },
  })

  const [file, setFile] = useState(null)
  const [message, setMessage] = useState<string | null>(null)
  const [profilePicture, setProfilePicture] = useState<string | null>(null)
  const [username, setUsername] = useState<string>("")
  const { session } = useSession()

  useEffect(() => {
    const fetchSessionAndProfilePicture = async () => {
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
  }, [session])

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    const userId = Number(session?.sub)

    if (file) {
      try {
        await uploadProfilePicture(userId, file)
        setMessage("Profile picture uploaded successfully")
      } catch (error: any) {
        setMessage(`Error uploading profile picture: ${error.message}`)
      }
    } else {
      setMessage("No file selected. Please select a file to upload.")
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (typeof window !== 'undefined' && window.File) {
      const selectedFile: File | null = e.target.files?.[0] || null;
      setFile(selectedFile as any);
      if (selectedFile) {
        setProfilePicture(URL.createObjectURL(selectedFile));
      }
    }
  }

  const handleSubmit = () => {
    form.handleSubmit(onSubmit)()
  }

  return (
    <>
      <div className="flex flex-col justify-center items-center min-h-screen bg-gray-900 ml-1/4">
        <div className="w-1/2">
          <Form {...form}>
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-6 text-white">
              <FormItem>
                <FormLabel htmlFor="picture" className="block text-2xl font-medium text-white">Profile Picture</FormLabel>
                <div className="flex items-center space-x-4">
                  <FormControl>
                    <div>
                      <input
                        id="picture"
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <label htmlFor="picture" className="cursor-pointer">
                        <div className="mr-4 w-16 h-16 rounded-full overflow-hidden flex-shrink-0">
                          {profilePicture ? (
                            <Image
                              src={profilePicture}
                              alt="User Profile Picture"
                              width={64}
                              height={64}
                              className="w-full h-full object-cover rounded-full"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-600 text-white rounded-full">
                              {username.substring(0, 2).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  </FormControl>
                </div>
                <FormMessage className="text-sm text-red-600" />
              </FormItem>
              {message && <p className="text-center text-red-600">{message}</p>}
              <Button type="submit" className="w-1/3 px-4 py-2 mt-6 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">Upload</Button>
            </form>
          </Form>
          <div className="mt-6">
            <ChangeBitrate />
          </div>
          <div className="mt-6">
            <ChangePassword />
          </div>
        </div>
      </div>
    </>
  );
}