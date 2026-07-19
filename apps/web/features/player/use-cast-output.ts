"use client";

import {
  getCastSessionEventsURL,
  getCurrentCastSession,
  sendCastCommand,
  stopCastSession,
  type CastCommand,
} from "@parson/music-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "@/features/account/session-provider";

const castSessionKey = ["cast-session", "current"] as const;

export function useCastOutput() {
  const { session: account } = useSession();
  const queryClient = useQueryClient();
  const [eventsConnected, setEventsConnected] = useState(false);
  const query = useQuery({
    queryKey: castSessionKey,
    queryFn: getCurrentCastSession,
    enabled: Boolean(account?.sub),
    // Poll slowly when proxies block WebSocket upgrades.
    refetchInterval: eventsConnected ? false : 30_000,
    staleTime: 1_000,
  });
  useEffect(() => {
    if (!account?.sub) {
      setEventsConnected(false);
      return;
    }
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let retryDelay = 1_000;
    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(getCastSessionEventsURL());
      } catch {
        reconnect = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
        return;
      }
      socket.onopen = () => {
        retryDelay = 1_000;
        setEventsConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string };
          if (message.type === "cast_session_changed") {
            void queryClient.invalidateQueries({ queryKey: castSessionKey });
          }
        } catch {}
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        setEventsConnected(false);
        if (!stopped) {
          reconnect = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      };
    };
    connect();
    return () => {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
    };
  }, [account?.sub, queryClient]);
  const command = useMutation({
    mutationFn: ({
      command,
      position_ms,
      volume,
      muted,
      queue_position,
    }: {
      command: CastCommand;
      position_ms?: number;
      volume?: number;
      muted?: boolean;
      queue_position?: number;
    }) => {
      if (!query.data) throw new Error("No cast session is active");
      return sendCastCommand(query.data.id, command, {
        position_ms,
        volume,
        muted,
        queue_position,
      });
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: castSessionKey }),
  });
  const stop = useMutation({
    mutationFn: async () => {
      if (query.data) await stopCastSession(query.data.id);
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: castSessionKey }),
  });
  return {
    session: query.data ?? null,
    loading: query.isLoading,
    error: query.error ?? command.error ?? stop.error,
    send: command.mutate,
    stop: stop.mutate,
    busy: command.isPending || stop.isPending,
  };
}
