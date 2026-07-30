"use client";

import { useEffect } from "react";

export default function GlobalError({ reset }: { reset: () => void }) {
  useEffect(() => {
    document.title = "Parson could not load";
  }, []);

  return (
    <html lang="en">
      <body className="bg-black text-white">
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">
              Parson could not load this screen
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              Your library was not changed. Try loading the app again.
            </p>
            <button
              className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
              onClick={reset}
              type="button"
            >
              Recover
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
