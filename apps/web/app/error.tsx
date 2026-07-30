"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route rendering failed", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-6 text-white">
      <section
        className="w-full max-w-lg rounded-xl border border-white/10 bg-zinc-950 p-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold">
          This screen could not be loaded
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Your library was not changed. Try loading this screen again.
        </p>
        {error.message ? (
          <details className="mt-3 text-xs leading-5 text-zinc-500">
            <summary className="cursor-pointer text-zinc-400">
              Technical details
            </summary>
            <p className="mt-2 break-words font-mono">{error.message}</p>
          </details>
        ) : null}
        <button
          className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
