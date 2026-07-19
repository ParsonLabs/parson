import SetupFlow from "@/features/setup/setup-flow";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Set up Parson",
  description: "Create your account and add your music.",
};

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center bg-black text-sm text-zinc-400">
          Getting things ready
        </main>
      }
    >
      <SetupFlow />
    </Suspense>
  );
}
