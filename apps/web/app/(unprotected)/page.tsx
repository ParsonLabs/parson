"use client";

import pl from "@/assets/pl-tp.png";
import { useSession } from "@/components/Providers/AuthProvider";
import ServerSelectIcon from "@/components/Setup/Server/ServerSelectIcon";
import getSession from "@/lib/Authentication/JWT/getSession";
import { zodResolver } from '@hookform/resolvers/zod';
import { getServerInfo } from "@music/sdk";
import { ServerInfo } from "@music/sdk/types";
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
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useState } from "react";
import { SubmitHandler, useForm } from 'react-hook-form';
import * as z from 'zod';

const schema = z.object({
  serverUrl: z.string().url({ message: 'Invalid URL' }).min(1, { message: 'Server URL is required' }),
});

type FormData = z.infer<typeof schema>;

export default function MainPage() {
  const [loading, setLoading] = useState(true);
  const [showServerURLInput, setShowServerURLInput] = useState(false);
  const [showServerSelect, setShowServerSelect] = useState(false);
  const { push } = useRouter();
  const { session } = useSession()

  useEffect(() => {
    const checkServerUrl = async () => {
      setLoading(true);

      try {
        const storedServer = localStorage.getItem("server");
        const response = await fetch(
          `${(storedServer && JSON.parse(storedServer).local_address) || window.location.origin}/api/s/server/info`
        );
        let serverInfo: ServerInfo = await response.json();

        if (serverInfo.product_name && serverInfo.startup_wizard_completed) {
          localStorage.setItem("server", JSON.stringify(serverInfo));

          if (session) {
            push("/home");
          } else {
            push("/login");
          }
        } else {
          if (!serverInfo.startup_wizard_completed && session) {
            push("/setup/library");
          } else {
            push("/setup");
          }
        }
      } catch (error) {
        console.error("Error checking server URL:", error);
        const storedServer = localStorage.getItem("server");
        if (storedServer) {
          setShowServerSelect(true);
        } else {
          setShowServerURLInput(true);
        }
      } finally {
        setLoading(false);
      }
    };

    checkServerUrl();
  }, [push, session]);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const { handleSubmit } = form;

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setLoading(true);
    
    try {
      const response = await fetch(`${data.serverUrl}/api/s/server/info`, {
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });

      const serverInfo = await response.json()

      if (serverInfo.product_name && serverInfo.startup_wizard_completed) {
        localStorage.setItem("server", JSON.stringify(serverInfo));

        if (session) {
          push("/home");
        } else {
          push("/login");
        }
      } else {
        localStorage.setItem("server", JSON.stringify({ local_address: data.serverUrl }));
        if (!serverInfo.startup_wizard_completed && session) {
          push("/setup/library");
        } else {
          push("/setup");
        }
      }
    } catch (error) {
      push("/setup");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="flex items-center mb-4">
          <Image src={pl} alt="ParsonLabs Logo" width={64} height={64} className="mr-4" />
          <p className="text-6xl font-bold">ParsonLabs Music</p>
        </div>
        <Loader2Icon className="animate-spin w-12 h-12 mt-4" stroke="#4338ca" />
      </div>
    );
  }

  if (showServerSelect) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <ServerSelectIcon />
      </div>
    );
  }

  if (showServerURLInput) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 text-white w-80">
            <p className="text-2xl mb-4">Enter Server URL</p>
            <FormField
              control={form.control}
              name="serverUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="block text-sm font-medium text-white">Server URL</FormLabel>
                  <FormControl>
                    <Input
                      className="block w-full px-3 py-2 mt-1 border border-gray-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white bg-gray-800"
                      placeholder="Enter server URL"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-sm text-red-600">{form.formState.errors.serverUrl?.message?.toString()}</FormMessage>
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full px-4 py-2 mt-6 text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Submit
            </Button>
          </form>
        </Form>
      </div>
    );
  }

  return null;
}