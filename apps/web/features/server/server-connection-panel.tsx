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
import { Loader2, RefreshCw, Radio } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

export default function ServerConnectionPanel() {
  const [manualServer, setManualServer] = useState("");
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [discoveryState, setDiscoveryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const refreshDiscovery = useCallback(async () => {
    setDiscoveryState("loading");
    try {
      setServers(
        (await discoverNearbyServers()).filter((server) => !server.isCurrent),
      );
      setDiscoveryState("ready");
    } catch {
      setServers([]);
      setDiscoveryState("error");
    }
  }, []);
  useEffect(() => {
    void refreshDiscovery();
  }, [refreshDiscovery]);

  function connect(origin: string) {
    if (!connectToServer(origin)) toast("Enter a valid Parson server address.");
  }

  function connectManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const origin = normalizeServerOrigin(manualServer);
    if (!origin) {
      toast("Enter a valid Parson server address.");
      return;
    }
    connect(origin);
  }

  return (
    <section>
      <div className="overflow-hidden rounded-lg border border-white/10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="px-4 py-3 text-sm font-medium text-zinc-200">
            Nearby libraries
          </h2>
          <Button
            aria-label="Look for nearby devices"
            className="mr-2"
            disabled={discoveryState === "loading"}
            onClick={() => void refreshDiscovery()}
            size="sm"
          >
            {discoveryState === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="border-t border-white/10">
          {discoveryState === "loading" ? (
            <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking nearby…
            </div>
          ) : servers.length ? (
            <div className="divide-y divide-white/10">
              {servers.map((server) => {
                return (
                  <div
                    className="flex items-center gap-3 p-4"
                    key={server.instanceId}
                  >
                    <Radio className="h-5 w-5 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {server.name}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {server.origin}
                      </p>
                    </div>
                    <Button onClick={() => connect(server.origin)} size="sm">
                      Connect
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-4 text-sm text-zinc-500">
              {discoveryState === "error"
                ? "Nearby discovery is unavailable. You can still enter an address below."
                : "No other Parson devices found."}
            </p>
          )}
        </div>
        <form
          className="flex gap-3 border-t border-white/10 p-3"
          onSubmit={connectManual}
        >
          <Input
            aria-label="Parson device address"
            onChange={(event) => setManualServer(event.target.value)}
            placeholder="Enter another library address"
            value={manualServer}
          />
          <Button type="submit">Connect</Button>
        </form>
      </div>
    </section>
  );
}
