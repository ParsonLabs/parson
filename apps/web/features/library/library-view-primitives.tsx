"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect, useRef } from "react";

export function InfiniteLoad({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const requested = useRef(false);

  useEffect(() => {
    if (!loading) requested.current = false;
  }, [loading]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || requested.current) return;
        requested.current = true;
        onLoadMore();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (!hasMore) return null;
  return (
    <div
      aria-label={loading ? "Loading more" : undefined}
      className="grid h-12 place-items-center"
      ref={sentinel}
      role={loading ? "status" : undefined}
    >
      {loading && (
        <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" />
      )}
    </div>
  );
}

export function LibraryLoading({ compact = false }: { compact?: boolean }) {
  void compact;
  return null;
}

export function LibraryMessage({
  action,
  body,
  customAction,
  href,
  onAction,
  title,
}: {
  action?: string;
  body?: string;
  customAction?: React.ReactNode;
  href?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 px-6 text-center">
      <div className="max-w-sm">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {body && <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>}
        {(action || customAction) && (
          <div className="mt-5 flex justify-center">
            {action && href ? (
              <Button asChild variant="outline">
                <Link href={href}>{action}</Link>
              </Button>
            ) : action ? (
              <Button onClick={onAction} variant="outline">
                {action}
              </Button>
            ) : null}
            {customAction}
          </div>
        )}
      </div>
    </div>
  );
}

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
