"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRight } from "lucide-react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { login, register } from "@music/sdk"
import { Button } from "@music/ui/components/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form"
import { Input } from "@music/ui/components/input"
import Link from "next/link"
import { useRouter } from "next/navigation"

const registerSchema = z.object({
  username: z.string().min(1, { message: "Username must be longer than 1 character" }),
  password: z.string().min(4, { message: "Password must be longer than 4 character" })
})

export default function Register() {
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: ""
    },
  })

const { push } = useRouter()
 
async function onSubmit(values: z.infer<typeof registerSchema>) {
  await register({ username: values.username, password: values.password, role: "admin" })
  await login({ username: values.username, password: values.password, role: "admin" })
  push("/setup/library")
}

  return (
    <div className="text-white min-h-screen flex flex-col justify-center items-center">
      <title>Account</title>
      <p className="text text-center text-4xl py-14">Tell us About Yourself</p>
      <div className="flex justify-center items-center">
  
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="block text-sm font-medium text-white">Username</FormLabel>
                  <FormControl>
                    <Input
                      className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                      placeholder="Enter your preferred username"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-sm text-red-600">{form.formState.errors.username?.message?.toString()}</FormMessage>
                </FormItem>
              )}
            />
  
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="block text-sm font-medium text-white">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                      placeholder="Enter your preferred password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-sm text-red-600">{form.formState.errors.password?.message?.toString()}</FormMessage>
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="px-4 py-2 mt-6 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Next
              <ArrowRight className="mr-2 h-4 w-4 ml-2" />
            </Button>
            <Link href="/setup/library" className="pl-10 underline text-white">
              I already have an account
            </Link>
          </form>
        </Form>
      </div>
    </div>
  )
}