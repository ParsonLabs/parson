import Link from "next/link";
import { Library, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The requested music page could not be found.",
};

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-black px-5 text-zinc-100">
      <section className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <div className="mt-6 flex gap-2">
          <Button asChild variant="outline">
            <Link href="/">
              <Home />
              Home
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/library">
              <Library />
              Library
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
