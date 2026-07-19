"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Cast, MonitorSpeaker, Smartphone, StopCircle } from "lucide-react";
import { ActionButton } from "./player-controls";
import { useCastOutput } from "./use-cast-output";

export function CastOutputButton({ menuItem = false }: { menuItem?: boolean }) {
  const { session, loading, error, send, stop, busy } = useCastOutput();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <span>
          {menuItem ? (
            <button
              className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-zinc-300 hover:bg-white/10 hover:text-white"
              type="button"
            >
              <Cast className="h-4 w-4" />
              Cast
              {session && (
                <span className="ml-auto h-2 w-2 rounded-full bg-emerald-400" />
              )}
            </button>
          ) : (
            <ActionButton
              active={Boolean(session)}
              label="Play on another device"
              onClick={() => {}}
            >
              <Cast className="h-4 w-4" />
            </ActionButton>
          )}
        </span>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Play on another device</DialogTitle>
          <DialogDescription>
            Playback surfaces connected to your Parson account appear here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 px-4 py-3">
            <Smartphone className="h-5 w-5 text-zinc-400" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">This computer</div>
              <div className="text-xs text-zinc-500">
                {session ? "Available" : "Playing here"}
              </div>
            </div>
          </div>
          {session ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <MonitorSpeaker className="h-5 w-5 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {session.receiver_name}
                  </div>
                  <div className="text-xs capitalize text-emerald-300/70">
                    {session.status} · controlled by Parson
                  </div>
                </div>
                <button
                  className="flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => stop()}
                  type="button"
                >
                  <StopCircle className="h-4 w-4" />
                  Stop
                </button>
              </div>
              <div className="mt-3 max-h-48 space-y-1 overflow-y-auto border-t border-white/10 pt-2">
                {session.items.map((item) => (
                  <button
                    key={`${item.position}-${item.song_id}`}
                    className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-xs ${item.position === session.current_position ? "bg-white/10 text-white" : "text-zinc-500"}`}
                    disabled={
                      busy || item.position === session.current_position
                    }
                    onClick={() =>
                      send({ command: "jump", queue_position: item.position })
                    }
                    type="button"
                  >
                    <span className="w-5 text-right tabular-nums">
                      {item.position + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    <span className="max-w-24 truncate">{item.artist}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-4 text-sm text-zinc-500">
              {loading
                ? "Checking for active playback…"
                : "Choose a Chromecast with the Cast button in Parson for Android. It will stay controllable here."}
            </div>
          )}
          {error && (
            <p className="text-xs text-red-400">
              {error instanceof Error
                ? error.message
                : "Casting is unavailable."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
