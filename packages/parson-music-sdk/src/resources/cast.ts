import api, { getApiWebSocketURL } from "../core/http";

export type CastSessionStatus =
  "connecting" | "playing" | "paused" | "stopped" | "ended" | "failed";

export type CastCommand =
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "stop"
  | "seek"
  | "set_volume"
  | "set_mute"
  | "jump";

export interface CastQueueItem {
  position: number;
  song_id: string;
  title: string;
  artist: string;
  album: string;
  artwork_url: string | null;
  media_url: string;
  content_type: string;
  duration_ms: number;
}

export interface CastSession {
  id: string;
  receiver_id: string;
  receiver_name: string;
  status: CastSessionStatus;
  current_position: number;
  position_ms: number;
  duration_ms: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  repeat_mode: "off" | "one" | "all";
  revision: number;
  command: CastCommand | null;
  command_position_ms: number | null;
  command_volume: number | null;
  command_muted: boolean | null;
  command_queue_position: number | null;
  command_revision: number;
  acknowledged_command_revision: number;
  expires_at: number;
  items: CastQueueItem[];
}

export async function createCastSession(input: {
  receiver_id: string;
  receiver_name: string;
  song_ids: string[];
  current_position?: number;
}): Promise<CastSession> {
  const response = await api.post<CastSession>("/cast/sessions", input);
  return response.data;
}

export async function getCurrentCastSession(): Promise<CastSession | null> {
  const response = await api.get<CastSession | undefined>(
    "/cast/sessions/current",
    { timeout: 4_000 },
  );
  return response.status === 204 ? null : (response.data ?? null);
}

export function getCastSessionEventsURL(): string {
  return getApiWebSocketURL("/cast/sessions/events");
}

export async function getCastSession(id: string): Promise<CastSession> {
  const response = await api.get<CastSession>(
    `/cast/sessions/${encodeURIComponent(id)}`,
    { timeout: 4_000 },
  );
  return response.data;
}

export async function updateCastSessionState(
  id: string,
  state: {
    revision: number;
    current_position: number;
    position_ms: number;
    duration_ms: number;
    playing: boolean;
    volume: number;
    muted: boolean;
    status: CastSessionStatus;
    acknowledged_command_revision: number;
  },
): Promise<{
  revision: number;
  command_revision: number;
  acknowledged_command_revision: number;
}> {
  const response = await api.patch(
    `/cast/sessions/${encodeURIComponent(id)}/state`,
    state,
  );
  return response.data;
}

export async function sendCastCommand(
  id: string,
  command: CastCommand,
  options: {
    position_ms?: number;
    volume?: number;
    muted?: boolean;
    queue_position?: number;
  } = {},
): Promise<{ revision: number; command_revision: number }> {
  const response = await api.post(
    `/cast/sessions/${encodeURIComponent(id)}/commands`,
    { command, ...options },
  );
  return response.data;
}

export async function stopCastSession(id: string): Promise<void> {
  await api.delete(`/cast/sessions/${encodeURIComponent(id)}`);
}
