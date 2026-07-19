import api from "../core/http";
import type { LibrarySong } from "../domain/types";

const MAX_BATCH_TRACK_IDS = 500;

export interface PlaylistBase {
  id: number;
  name: string;
  description?: string;
  cover_image?: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlaylistSummary extends PlaylistBase {
  song_count: number;
  total_duration: number;
  cover_songs: LibrarySong[];
}

export type PlaylistsResponse = PlaylistSummary;

export interface PlaylistResponse extends PlaylistSummary {
  song_infos: { song_id: string; date_added: string }[];
  songs: LibrarySong[];
  user_ids: number[];
}

export async function getPlaylists(): Promise<PlaylistSummary[]> {
  const response = await api.get<PlaylistSummary[]>("/playlists");
  return response.data;
}

export async function getPlaylist(id: number): Promise<PlaylistResponse> {
  const response = await api.get<PlaylistResponse>(`/playlists/${id}`);
  return response.data;
}

export async function createPlaylist(
  name: string,
  songIds: string[] = [],
  albumId?: string,
): Promise<PlaylistSummary> {
  const response = await api.post<PlaylistSummary>("/playlists", {
    name,
    song_ids: Array.from(new Set(songIds.filter(Boolean))).slice(
      0,
      MAX_BATCH_TRACK_IDS,
    ),
    album_id: albumId,
  });
  return response.data;
}

export async function deletePlaylist(id: number): Promise<void> {
  await api.delete(`/playlists/${id}`);
}

export async function updatePlaylist(
  id: number,
  changes: { name?: string; description?: string },
): Promise<void> {
  await api.patch(`/playlists/${id}`, changes);
}

export async function addSongToPlaylist(
  id: number,
  songId: string,
): Promise<void> {
  await api.post(`/playlists/${id}/tracks`, { song_id: songId });
}

export async function addSongsToPlaylist(
  id: number,
  songIds: string[],
): Promise<void> {
  const uniqueSongIds = Array.from(new Set(songIds.filter(Boolean)));
  if (uniqueSongIds.length === 0) return;
  for (
    let offset = 0;
    offset < uniqueSongIds.length;
    offset += MAX_BATCH_TRACK_IDS
  ) {
    await api.post(`/playlists/${id}/tracks/batch`, {
      song_ids: uniqueSongIds.slice(offset, offset + MAX_BATCH_TRACK_IDS),
    });
  }
}

export async function addAlbumToPlaylist(
  id: number,
  albumId: string,
): Promise<void> {
  await api.post(`/playlists/${id}/albums/${encodeURIComponent(albumId)}`);
}

export async function removeSongFromPlaylist(
  id: number,
  songId: string,
): Promise<void> {
  await api.delete(`/playlists/${id}/tracks/${encodeURIComponent(songId)}`);
}
