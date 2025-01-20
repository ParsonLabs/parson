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
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      password: "",
      admin: false,
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    const role = values.admin ? "admin" : "user"
    register({ username: values.username, password: values.password, role })
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-zinc-950">
      <div className="w-1/2">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 text-white">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Username</FormLabel>
                  <FormControl>
                    <Input placeholder="Username" {...field} className="bg-gray-800 text-white border-gray-700" />
                  </FormControl>
                  <FormDescription className="text-gray-400">
                    This is their public display name.
                  </FormDescription>
                  <FormMessage className="text-red-600" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-white">Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Password" {...field} className="bg-gray-800 text-white border-gray-700" />
                  </FormControl>
                  <FormMessage className="text-red-600" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="admin"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 border-gray-700">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="text-indigo-600"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-white">Admin</FormLabel>
                    <FormDescription className="text-gray-400">
                      Check this box if you want to register this user as an admin.
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full px-4 py-2 mt-6 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
              Create User
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}