"use client";

import { useEffect, useState } from "react";
import getSession from "@/lib/Authentication/JWT/getSession";
import { zodResolver } from "@hookform/resolvers/zod";
import { changePassword } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import { FormItem, FormLabel, FormControl, FormMessage } from "@music/ui/components/form";
import { Input } from "@music/ui/components/input";
import { Form, useForm, FormProvider } from "react-hook-form";
import { z } from "zod";
import { useSession } from "../Providers/AuthProvider";

const changePasswordSchema = z.object({
  password: z
    .string()
    .min(4, { message: "Password must be longer than 4 characters" }),
  confirmPassword: z
    .string()
    .min(4, { message: "Password must be longer than 4 characters" }),
});

export function ChangePassword() {
  const [isClient, setIsClient] = useState(false);
  const { session } = useSession()

  useEffect(() => {
    setIsClient(true);
  }, []);

  const form = useForm<z.infer<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof changePasswordSchema>) => {
    if (data.password === data.confirmPassword) {
      await changePassword(session?.username ?? "", data.password, data.confirmPassword);
    } else {
      // handle password mismatch
    }
  };

  if (!isClient) {
    return null;
  }

    return (
      <div className="text-white bg-gray-900 rounded-md">
        <FormProvider {...form}>

          <FormLabel className="block text-2xl font-medium text-white mb-2">Change Password</FormLabel>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Form>
              <FormItem>
                <FormLabel htmlFor="password" className="block text-sm font-medium text-white">Password</FormLabel>
                <FormControl>
                  <Input
                    id="password"
                    type="password"
                    {...form.register("password")}
                    placeholder="Enter your password"
                    className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                  />
                </FormControl>
                <FormMessage className="text-sm text-red-600" />
              </FormItem>
              <FormItem className="mt-4">
                <FormLabel htmlFor="confirmPassword" className="block text-sm font-medium text-white">Confirm Password</FormLabel>
                <FormControl>
                  <Input
                    id="confirmPassword"
                    type="password"
                    {...form.register("confirmPassword")}
                    placeholder="Confirm your password"
                    className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                  />
                </FormControl>
                <FormMessage className="text-sm text-red-600" />
              </FormItem>
              <Button type="submit" className="w-1/3 mt-4 px-4 py-2 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                Update Password
              </Button>
            </Form>
          </form>
        </FormProvider>
      </div>
    );;
}