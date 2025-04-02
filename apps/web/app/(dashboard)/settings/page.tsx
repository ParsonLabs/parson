"use client"

import ChangeBitrate from "@/components/User/ChangeBitrate"
import { ChangePassword } from "@/components/User/ChangePassword"
import getSession from "@/lib/Authentication/JWT/getSession"
import { zodResolver } from "@hookform/resolvers/zod"
import { uploadProfilePicture, getProfilePicture } from "@music/sdk"
import { Button } from "@music/ui/components/button"
import { Camera, User as UserIcon } from "lucide-react"
import Image from "next/image"
import {
  Form,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form"
import { Input } from "@music/ui/components/input"
import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useSession } from "@/components/Providers/AuthProvider"
import { motion } from "framer-motion"

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
  const [messageType, setMessageType] = useState<'success' | 'error'>('error')
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
        setMessageType('success')
        setMessage("Profile picture updated successfully")
        setTimeout(() => setMessage(null), 3000)
      } catch (error: any) {
        setMessageType('error')
        setMessage(`Error uploading profile picture: ${error.message}`)
      }
    } else {
      setMessageType('error')
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
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-semibold text-white mb-6">Profile Settings</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-xl font-medium text-white mb-4">Profile Picture</h2>
            <Form {...form}>
              <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-6">
                <FormItem>
                  <div className="flex flex-col items-center space-y-4">
                    <FormControl>
                      <div className="relative group">
                        <input
                          id="picture"
                          type="file"
                          accept="image/*"
                          onChange={handleFileChange}
                          className="hidden"
                        />
                        <label htmlFor="picture" className="cursor-pointer block">
                          <div className="w-32 h-32 rounded-full overflow-hidden relative group">
                            {profilePicture ? (
                              <Image
                                src={profilePicture}
                                alt="User Profile"
                                width={128}
                                height={128}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-indigo-800/70 to-purple-700/70 text-white">
                                <UserIcon size={48} />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-200">
                              <Camera className="w-8 h-8 text-white" />
                            </div>
                          </div>
                        </label>
                      </div>
                    </FormControl>
                    <div>
                      <p className="text-gray-300 text-center text-sm">Click to upload a new profile picture</p>
                    </div>
                  </div>
                  <FormMessage className="text-sm text-red-500 text-center" />
                </FormItem>
                
                {message && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-3 rounded-md text-center text-sm ${
                      messageType === 'success' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'
                    }`}
                  >
                    {message}
                  </motion.div>
                )}
                
                <div className="flex justify-center">
                  <Button 
                    type="submit" 
                    className="px-6 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                  >
                    Update Profile Picture
                  </Button>
                </div>
              </form>
            </Form>
          </div>
          <div>
            <h2 className="text-xl font-medium text-white mb-4">Account Settings</h2>
            <div className="space-y-6">
              <div className="p-5 bg-zinc-800/50 rounded-lg border border-zinc-700/50 shadow-inner">
                <h3 className="text-md font-medium text-white mb-4">Audio Quality</h3>
                <ChangeBitrate />
              </div>
              
              <div className="p-5 bg-zinc-800/50 rounded-lg border border-zinc-700/50 shadow-inner">
                <h3 className="text-md font-medium text-white mb-4">Security</h3>
                <ChangePassword />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}