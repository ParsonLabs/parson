"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body className="bg-black text-white">
        <main className="flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-semibold">Something went wrong</h1>
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
