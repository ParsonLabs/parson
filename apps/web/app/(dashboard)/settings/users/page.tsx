"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Button } from "@music/ui/components/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form"
import { Input } from "@music/ui/components/input"
import { Checkbox } from "@music/ui/components/checkbox"
import { register } from "@music/sdk"
import { useState } from "react"
import { motion } from "framer-motion"
import { Check, Shield, User, UserPlus } from "lucide-react"

const formSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }),
  password: z.string().min(6, {
    message: "Password must be at least 6 characters.",
  }),
  admin: z.boolean().default(false).optional(),
})

export default function UsersPage() {
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
      admin: false,
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const role = values.admin ? "admin" : "user"
      await register({ username: values.username, password: values.password, role })
      
      setSuccessMessage(`User ${values.username} has been created successfully`)
      form.reset()
      
      setTimeout(() => {
        setSuccessMessage(null)
      }, 5000)
    } catch (error) {
      console.error("Error creating user:", error)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white mb-6">User Management</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <div className="bg-zinc-800/50 rounded-lg border border-zinc-700/50 p-6 shadow-inner">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-indigo-600/20">
                  <UserPlus className="h-5 w-5 text-indigo-400" />
                </div>
                <h2 className="text-xl font-medium text-white">Create New User</h2>
              </div>
              
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-200">Username</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input 
                              placeholder="Enter username" 
                              {...field} 
                              className="bg-zinc-900/80 border-zinc-700/50 pl-10 focus-visible:ring-indigo-500" 
                            />
                          </div>
                        </FormControl>
                        <FormDescription className="text-gray-400 text-xs">
                          This is their public display name.
                        </FormDescription>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-gray-200">Password</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Shield className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                            <Input 
                              type="password" 
                              placeholder="Enter password" 
                              {...field} 
                              className="bg-zinc-900/80 border-zinc-700/50 pl-10 focus-visible:ring-indigo-500" 
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-red-400" />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="admin"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 border-zinc-700/50 bg-zinc-900/40">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel className="text-gray-200">Administrator</FormLabel>
                          <FormDescription className="text-gray-400 text-xs">
                            Grant administrative privileges to this user.
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                  
                  {successMessage && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-2 p-3 rounded-md bg-green-900/40 text-green-300 text-sm"
                    >
                      <Check className="h-4 w-4" />
                      {successMessage}
                    </motion.div>
                  )}
                  
                  <Button 
                    type="submit" 
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                  >
                    Create User
                  </Button>
                </form>
              </Form>
            </div>
          </div>
          
          <div>
            <div className="bg-zinc-800/50 rounded-lg border border-zinc-700/50 p-6 shadow-inner h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-purple-600/20">
                  <User className="h-5 w-5 text-purple-400" />
                </div>
                <h2 className="text-xl font-medium text-white">User Management</h2>
              </div>
              <p className="text-gray-300 mb-4">
                Manage your server users here. In the future, this section will display all users and allow you to modify their permissions.
              </p>
              <div className="py-8 text-center text-gray-400 italic">
                User list functionality coming soon
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}