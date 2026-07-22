"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  connectToServer,
  normalizeServerOrigin,
} from "@/features/server/server-connection";
import {
  discoverNearbyServers,
  type DiscoveredServer,
} from "@parson/music-sdk";
import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

function displayAddress(origin: string) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export default function LibraryConnectionCard() {
  const [manualAddress, setManualAddress] = useState("");
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [libraries, setLibraries] = useState<DiscoveredServer[]>([]);
  const [discoveryState, setDiscoveryState] = useState<
    "loading" | "ready" | "error"
  >("loading");

  const refreshDiscovery = useCallback(async () => {
    setDiscoveryState("loading");
    try {
      setLibraries(
        (await discoverNearbyServers()).filter((library) => !library.isCurrent),
      );
      setDiscoveryState("ready");
    } catch {
      setLibraries([]);
      setDiscoveryState("error");
    }
  }, []);

  useEffect(() => {
    setCurrentOrigin(window.location.origin);
    void refreshDiscovery();
  }, [refreshDiscovery]);

  function connect(origin: string, name: string) {
    if (!connectToServer(origin, name)) {
      toast("Enter a valid Parson library address.");
    }
  }

  function connectManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const origin = normalizeServerOrigin(manualAddress);
    if (!origin) {
      toast("Enter a valid Parson library address.");
      return;
    }
    connect(origin, displayAddress(origin));
  }

  return (
    <div className="w-full max-w-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200">
      <h1 className="text-3xl font-bold tracking-tight">Connect to Parson</h1>

      <section className="mt-8" aria-labelledby="this-library-heading">
        <h2
          className="text-sm font-semibold text-zinc-200"
          id="this-library-heading"
        >
          This library
        </h2>
        <div className="mt-3 flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Local library</p>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {currentOrigin || "Current device"}
            </p>
          </div>
          <Button
            asChild
            className="rounded-full bg-white px-4 text-black hover:bg-zinc-200"
            size="sm"
          >
            <Link href="/">Use this library</Link>
          </Button>
        </div>
      </section>

      <section className="mt-7" aria-labelledby="nearby-libraries-heading">
        <div className="flex h-9 items-center justify-between">
          <h2
            className="text-sm font-semibold text-zinc-200"
            id="nearby-libraries-heading"
          >
            Nearby
          </h2>
          <button
            aria-label="Refresh nearby libraries"
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
            disabled={discoveryState === "loading"}
            onClick={() => void refreshDiscovery()}
            type="button"
          >
            {discoveryState === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>

        {discoveryState === "loading" ? (
          <p className="py-5 text-sm text-zinc-500" role="status">
            Looking for nearby libraries…
          </p>
        ) : libraries.length ? (
          <div className="divide-y divide-white/[0.08]">
            {libraries.map((library) => (
              <div
                className="flex items-center gap-4 py-4"
                key={library.instanceId}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {library.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {displayAddress(library.origin)}
                  </p>
                </div>
                <Button
                  className="rounded-full bg-white px-4 text-black hover:bg-zinc-200"
                  onClick={() => connect(library.origin, library.name)}
                  size="sm"
                >
                  Connect
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-5 text-sm text-zinc-500">
            {discoveryState === "error"
              ? "Nearby libraries could not be checked."
              : "No nearby libraries found."}
          </p>
        )}
      </section>

      <form className="mt-7" onSubmit={connectManual}>
        <label
          className="mb-2 block text-sm font-semibold text-zinc-200"
          htmlFor="library-address"
        >
          Enter an address
        </label>
        <Input
          autoCapitalize="none"
          autoCorrect="off"
          className="h-12 rounded-xl px-4 text-base"
          id="library-address"
          onChange={(event) => setManualAddress(event.target.value)}
          placeholder="music-room.local or 192.168.1.20"
          spellCheck={false}
          value={manualAddress}
        />
        <div className="mt-4 flex items-center gap-3">
          <Button asChild className="h-12 flex-1 rounded-full" variant="ghost">
            <Link href="/login">Back</Link>
          </Button>
          <Button
            className="h-12 flex-1 rounded-full bg-white text-base text-black hover:bg-zinc-200"
            disabled={!manualAddress.trim()}
            type="submit"
          >
            Connect
          </Button>
        </div>
      </form>
    </div>
  );
}
