"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@music/ui/components/select";

import getSession from "@/lib/Authentication/JWT/getSession";
import { zodResolver } from "@hookform/resolvers/zod";
import { setBitrate } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@music/ui/components/form";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useState } from "react";
import { useSession } from "../Providers/AuthProvider";

const FormSchema = z.object({
  bitrate: z.string({
    required_error: "Please select a bitrate.",
  }),
  customBitrate: z.number().optional(),
});

export default function ChangeBitrate() {
  const { session } = useSession()
  const [message, setMessage] = useState<string | null>(null);

  const bitrateMapping: { [key: string]: number } = {
    low: 96,
    normal: 128,
    high: 256,
    lossless: 0,
  };

  const selectedBitrate = Object.keys(bitrateMapping).find(
    (key) => bitrateMapping[key] === 0
  );

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      bitrate: selectedBitrate,
      customBitrate: undefined,
    },
  });

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    const bitrateMapping: {
      [key in z.infer<typeof FormSchema>["bitrate"]]: number;
    } = {
      low: 96,
      normal: 128,
      high: 256,
      lossless: 0,
    };

    const newBitrate =
      data.bitrate === "custom" ? Number(data.customBitrate) : bitrateMapping[data.bitrate];

    if (newBitrate !== undefined) {
      setBitrate(Number(session?.sub), newBitrate);
      setMessage("Bitrate changed successfully!");
    } else {
      setMessage("Failed to change bitrate.");
    }
  }

  function onBitrateChange(value: string) {
    form.setValue("bitrate", value);
    form.trigger("bitrate");
  }

  return (
    <div className="text-white bg-zinc-950 rounded-md">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Form {...form}>
          <FormField
            control={form.control}
            name="bitrate"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="block text-2xl font-medium text-white">
                  Audio Quality
                </FormLabel>
                <Select
                  value={form.watch("bitrate")}
                  onValueChange={onBitrateChange}
                >
                  <FormControl>
                    <SelectTrigger className="w-[180px] bg-gray-800 border border-gray-600 text-white">
                      <SelectValue placeholder="Select a bitrate" />
                    </SelectTrigger>
                  </FormControl>

                  <SelectContent className="bg-gray-800 text-white">
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="lossless">Lossless</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-sm text-gray-400">
                  Set the audio quality when streaming, Low = 96kbps, Normal =
                  128kbps, High = 256kbps...
                </FormDescription>
                <FormMessage className="text-sm text-red-600" />
              </FormItem>
            )}
          />
          {form.watch("bitrate") === "custom" && (
            <FormField
              control={form.control}
              name="customBitrate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="block text-2xl font-medium text-white">
                    Custom Bitrate
                  </FormLabel>
                  <FormControl>
                    <input
                      type="number"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      className="w-[180px] bg-gray-800 border border-gray-600 text-white"
                      placeholder="Enter custom bitrate"
                    />
                  </FormControl>
                  <FormMessage className="text-sm text-red-600" />
                </FormItem>
              )}
            />
          )}
          <Button
            type="submit"
            className="w-1/3 mt-4 px-4 py-2 text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Change Quality
          </Button>
          {message && (
            <div className="mt-4 text-sm text-green-500">{message}</div>
          )}
        </Form>
      </form>
    </div>
  );
}