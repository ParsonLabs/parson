"use client";

import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LibraryReadiness } from "@parson/music-sdk";

interface LibraryStatusProps {
  readiness: LibraryReadiness;
  onRetry?: () => void;
}

const copyByState = {
  no_library_indexed: {
    title: "No library indexed",
    body: "Choose a music folder and index it before browsing your library.",
    action: "Set up library",
    href: "/setup",
  },
  indexing: {
    title: "Library indexing",
    body: "Your library is being scanned. This page will refresh when the index is ready.",
    action: "Open setup",
    href: "/setup",
  },
  failed: {
    title: "Library index failed",
    body: "Indexing hit a problem. Check the scanner output and try again.",
    action: "Open library settings",
    href: "/settings",
  },
  ready: {
    title: "Library ready",
    body: "Your library is ready.",
    action: "Refresh",
    href: "/",
  },
} satisfies Record<
  LibraryReadiness["state"],
  {
    title: string;
    body: string;
    action: string;
    href: string;
  }
>;

export default function LibraryStatus({
  readiness,
  onRetry,
}: LibraryStatusProps) {
  const copy = copyByState[readiness.state];
  const isIndexing = readiness.state === "indexing";
  const isFailed = readiness.state === "failed";
  const isEmpty = readiness.state === "no_library_indexed";

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-lg border border-white/10 bg-zinc-950 p-6 text-zinc-100 shadow-none">
        <div className="flex items-start gap-4">
          {!isEmpty && (
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
              {isIndexing ? (
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              ) : isFailed ? (
                <AlertCircle className="h-5 w-5 text-zinc-300" />
              ) : null}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            {!isEmpty && (
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {readiness.message || copy.body}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={copy.href}>
                <Button>{copy.action}</Button>
              </Link>
              {onRetry && (
                <Button variant="outline" onClick={onRetry}>
                  Check again
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
