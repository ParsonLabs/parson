"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import Link from "next/link";

export default function EntityPageState({
  kind,
  loading = false,
  onRetry,
}: {
  kind: "album" | "artist";
  loading?: boolean;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-zinc-500">
        <span className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading {kind}…
        </span>
      </div>
    );
  }

  return (
    <div className="grid min-h-[60vh] place-items-center px-5 text-center">
      <div className="max-w-sm">
        <h1 className="text-2xl font-semibold text-white">
          {kind === "album" ? "Album unavailable" : "Artist unavailable"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          It may have moved during a library refresh, or the server could not be
          reached.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {onRetry && (
            <Button onClick={onRetry} variant="outline">
              Try again
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/library">Back to library</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
