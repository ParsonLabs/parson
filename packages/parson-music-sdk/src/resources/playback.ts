import api, { isApiError } from "../core/http";
import type { AlbumInfo, ArtistInfo } from "../domain/types";

export interface PlaybackQueueSong {
  id: string;
  name: string;
  artist: string;
  contributing_artists: string[];
  contributing_artist_ids: string[];
  track_number: number;
  duration: number;
  album_object: AlbumInfo;
  artist_object: ArtistInfo;
  origin: "manual" | "generated";
  queue_position: number;
}

export interface PlaybackQueue {
  id: string;
  revision: number;
  current_position: number;
  items: PlaybackQueueSong[];
}

export interface PlaybackQueueRevisionConflict {
  revision: number;
  current_position: number;
}

export function getPlaybackQueueRevisionConflict(
  error: unknown,
): PlaybackQueueRevisionConflict | null {
  if (!isApiError(error) || error.response?.status !== 409) return null;
  const data = error.response.data as Partial<
    PlaybackQueueRevisionConflict & { error: string }
  >;
  return data?.error === "queue_revision_conflict" &&
    Number.isInteger(data.revision) &&
    Number(data.revision) >= 1 &&
    Number.isInteger(data.current_position) &&
    Number(data.current_position) >= 0
    ? {
        revision: Number(data.revision),
        current_position: Number(data.current_position),
      }
    : null;
}

export async function createPlaybackQueue(options: {
  seed_song_id?: string;
  explicit_song_ids?: string[];
  exclude_song_ids?: string[];
  generated_items?: number;
  source?: string;
}): Promise<PlaybackQueue> {
  const response = await api.post<PlaybackQueue>("/playback/queues", options);
  return response.data;
}

export async function getPlaybackQueue(id: string): Promise<PlaybackQueue> {
  const response = await api.get<PlaybackQueue>(
    `/playback/queues/${encodeURIComponent(id)}`,
  );
  return response.data;
}

export async function updatePlaybackQueuePosition(
  id: string,
  currentPosition: number,
  revision: number,
): Promise<{ current_position: number; revision: number }> {
  const response = await api.patch<{
    current_position: number;
    revision: number;
  }>(`/playback/queues/${encodeURIComponent(id)}`, {
    current_position: currentPosition,
    revision,
  });
  return response.data;
}
