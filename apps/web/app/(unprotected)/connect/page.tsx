import LibraryConnectionCard from "@/features/server/library-connection-card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect",
  description: "Choose which Parson music library to use.",
};

export default function ConnectPage() {
  return (
    <main className="flex min-h-screen min-h-dvh items-center justify-center px-5 py-24">
      <LibraryConnectionCard />
    </main>
  );
}
