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
import { Laptop, Loader2, RefreshCw, Radio } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

export default function ServerConnectionPanel() {
  const [manualServer, setManualServer] = useState("");
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [discoveryState, setDiscoveryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  useEffect(() => setCurrentOrigin(window.location.origin), []);
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
    <div className="grid gap-8">
      <section>
        <h2 className="text-base font-semibold text-white">
          Library availability
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Parson is available to your devices.
        </p>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-white/10 p-4">
          <Laptop className="h-5 w-5 text-zinc-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Local address</p>
            <p className="truncate text-xs text-zinc-500">{currentOrigin}</p>
          </div>
          <span className="text-xs text-zinc-500">Connected</span>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Nearby libraries
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Parson libraries and devices available on your local network.
            </p>
          </div>
          <Button
            aria-label="Look for nearby devices"
            className="border-white/10 bg-transparent text-zinc-300 hover:bg-white/5"
            disabled={discoveryState === "loading"}
            onClick={() => void refreshDiscovery()}
            size="sm"
            variant="outline"
          >
            {discoveryState === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
          {discoveryState === "loading" ? (
            <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking nearby…
            </div>
          ) : servers.length ? (
            <div className="divide-y divide-white/10">
              {servers.map((server) => {
                const connected = server.origin === currentOrigin;
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
                    <Button
                      className="bg-white text-black hover:bg-zinc-200"
                      disabled={connected}
                      onClick={() => connect(server.origin)}
                      size="sm"
                    >
                      {connected ? "Connected" : "Connect"}
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
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">Pair a device</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Enter the address shown by Parson on the other device.
        </p>
        <form className="mt-3 flex gap-3" onSubmit={connectManual}>
          <Input
            aria-label="Parson device address"
            onChange={(event) => setManualServer(event.target.value)}
            placeholder="music-room.local or 192.168.1.20"
            value={manualServer}
          />
          <Button
            className="bg-white text-black hover:bg-zinc-200"
            type="submit"
          >
            Connect
          </Button>
        </form>
      </section>
    </div>
  );
}
