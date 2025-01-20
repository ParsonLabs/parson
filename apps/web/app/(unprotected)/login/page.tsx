"use client";

import { useSession } from "@/components/Providers/AuthProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { zodResolver } from '@hookform/resolvers/zod';
import { getServerInfo } from "@music/sdk";
import { Button } from '@music/ui/components/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form";
import { Input } from '@music/ui/components/input';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SubmitHandler, useForm } from 'react-hook-form';
import * as z from 'zod';

const schema = z.object({
  username: z.string().min(1, { message: 'Username is required' }),
  password: z.string().min(1, { message: 'Password is required' }),
});

type FormData = z.infer<typeof schema>;

export default function Login() {
  const { push } = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverInfo, setServerInfo] = useState<{ login_disclaimer?: string } | null>(null);
  const { session, refreshSession } = useSession();
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    async function fetchServerInfo() {
      try {
        const info = await getServerInfo();
        setServerInfo(info);
      } catch (error) {
        console.error('Error fetching server info:', error);
      }
    };

    if (session?.username) {
      push("/home");
      return;
    }

    fetchServerInfo();
  }, [session?.username, push]);

  const { handleSubmit } = form;

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`${getBaseURL()}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        credentials: 'include'
      });
  
      const result = await response.json();
  
      if (response.ok && result.status) {
        await new Promise(resolve => setTimeout(resolve, 100));
        await refreshSession();
        await new Promise(resolve => setTimeout(resolve, 100));
        push("/home");
      } else {
        setErrorMessage(result.message || 'Authentication failed');
      }
    } catch (error) {
      setErrorMessage('An error occurred during login');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950">
      <h1 className="text-2xl font-bold text-center text-white pb-10">Sign In</h1>
      {errorMessage && (
        <div className="text-center text-red-600">
          {errorMessage}
        </div>
      )}
      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 text-white w-80">
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="block text-sm font-medium text-white">Username</FormLabel>
                <FormControl>
                  <Input
                    className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                    placeholder="Enter your username"
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
                    placeholder="Enter your password"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-sm text-red-600">{form.formState.errors.password?.message?.toString()}</FormMessage>
              </FormItem>
            )}
          />
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-2 mt-6 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Logging in...' : 'Login'}
          </Button>
        </form>
      </Form>

      {serverInfo?.login_disclaimer && (
        <p className="mt-4 text-center text-gray-400">{serverInfo.login_disclaimer}</p>
      )}
    </div>
  );
}