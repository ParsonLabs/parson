"use client"

import { Input } from "@music/ui/components/input"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import getSession from "@/lib/Authentication/JWT/getSession"
import { Button } from "@music/ui/components/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form"
import { useSession } from "../Providers/AuthProvider"

export default function Username() {
  const { session } = useSession()
  const username = session?.username

  const FormSchema = z.object({
    username: z.string()
      .min(2, {
        message: "Username must be at least 2 characters.",
      })
      .refine(value => !value.includes(' '), {
        message: "Username cannot contain a space",
      }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      username: "", 
    },
  })

  function onSubmit(data: z.infer<typeof FormSchema>) {
    console.log(data.username)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder={username} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-1/3">Change Username</Button>
      </form>
    </Form>
  )
}