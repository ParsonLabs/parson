import ServerConnectionPanel from "@/features/server/server-connection-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Connect",
  description: "Choose which Parson music library to use.",
};

export default function ConnectPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-20 sm:px-7">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        Parson servers
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-white">
        Choose a library
      </h1>
      <p className="mb-10 mt-3 text-sm text-zinc-400">
        Use the library hosted on this device or connect directly to another
        Parson server.
      </p>
      <ServerConnectionPanel />
    </main>
  );
}
