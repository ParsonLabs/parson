import api from "../core/http";
import type { LibrarySong, ListenHistoryItem, User } from "../domain/types";

export interface SettingsUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

export async function getUsers(): Promise<SettingsUser[]> {
  const response = await api.get<SettingsUser[]>("/users");
  return Array.isArray(response.data) ? response.data : [];
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<string> {
  const response = await api.post("/users/me/password", {
    current_password: currentPassword,
    new_password: newPassword,
  });
  return response.data;
}

export async function getListenHistory(
  options: { limit?: number; before_id?: number; offset?: number } = {},
): Promise<ListenHistoryItem[]> {
  const response = await api.get<ListenHistoryItem[]>("/users/me/history", {
    params: options,
  });
  return response.data;
}

export async function addSongToListenHistory(songId: string): Promise<string> {
  const response = await api.post("/users/me/history", {
    song_id: songId,
  });
  return response.data;
}

export interface FavoriteSong {
  song_id: string;
  added_at: string;
}

export interface FavoriteSongDetail extends FavoriteSong {
  song: LibrarySong;
}

export interface FavoritePageOptions {
  limit?: number;
  before_added_at?: string;
  before_song_id?: string;
  /** @deprecated Use the keyset cursor fields for stable deep-page latency. */
  offset?: number;
}

export async function getFavoriteSongs(
  options: FavoritePageOptions = {},
): Promise<FavoriteSong[]> {
  const response = await api.get<FavoriteSong[]>("/users/me/favorites", {
    params: options,
  });
  return response.data;
}

export async function getFavoriteSongDetails(
  options: FavoritePageOptions = {},
): Promise<FavoriteSongDetail[]> {
  const response = await api.get<FavoriteSongDetail[]>(
    "/users/me/favorites/songs",
    { params: options },
  );
  return response.data;
}

export async function getListenHistorySongs(
  options: { limit?: number; before_id?: number; offset?: number } = {},
): Promise<LibrarySong[]> {
  const response = await api.get<LibrarySong[]>("/users/me/history/songs", {
    params: options,
  });
  return response.data;
}

export async function isFavoriteSong(songId: string): Promise<boolean> {
  const response = await api.get<{ liked: boolean }>(
    `/users/me/favorites/${encodeURIComponent(songId)}`,
    { timeout: 4_000 },
  );
  return response.data.liked;
}

export async function addFavoriteSong(songId: string): Promise<void> {
  await api.post(`/users/me/favorites/${encodeURIComponent(songId)}`);
}

export async function removeFavoriteSong(songId: string): Promise<void> {
  await api.delete(`/users/me/favorites/${encodeURIComponent(songId)}`);
}

export type PlaybackEventType =
  | "play_started"
  | "manual_selection"
  | "qualified_play"
  | "completed"
  | "early_skip"
  | "manual_queue_add"
  | "playlist_add"
  | "recommendation_impression"
  | "recommendation_selected"
  | "disliked";

export interface PlaybackEvent {
  event_key: string;
  song_id: string;
  event_type: PlaybackEventType;
  session_id?: string;
  queue_id?: string;
  source?: string;
  position_seconds?: number;
  duration_seconds?: number;
}

export async function recordPlaybackEvent(
  event: PlaybackEvent,
): Promise<{ accepted: boolean; qualified: boolean }> {
  const response = await api.post<{ accepted: boolean; qualified: boolean }>(
    "/users/me/playback-events",
    event,
  );
  return response.data;
}

export async function setBitrate(bitrate: number): Promise<string> {
  const response = await api.patch("/users/me/preferences", {
    bitrate,
  });
  return response.data;
}

export async function setNowPlaying(nowPlaying: string): Promise<string> {
  const response = await api.patch("/users/me/playback", {
    now_playing: nowPlaying,
  });
  return response.data;
}

export async function getNowPlaying(): Promise<{ now_playing: string | null }> {
  const response = await api.get("/users/me/playback");
  return response.data;
}

export async function getUserInfo(username: string): Promise<User> {
  const response = await api.get<User>(
    `/users/by-username/${encodeURIComponent(username)}`,
  );
  return response.data;
}

export async function getUserInfoById(id: number): Promise<User> {
  const response = await api.get<User>(`/users/${id}`);
  return response.data;
}

export async function getProfilePicture(userId: number): Promise<Blob> {
  const response = await api.get(`/users/${userId}/avatar`, {
    responseType: "blob",
  });
  return response.data;
}

export async function uploadProfilePicture(
  userId: number,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.append("picture", file);

  const response = await api.put(`/users/${userId}/avatar`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
}

export async function getRecommendedFull(
  userId: number,
  songId?: string,
): Promise<LibrarySong[]> {
  const response = await api.get<LibrarySong[]>(
    `/users/${userId}/recommendations`,
    {
      params: { song_id: songId },
    },
  );
  return response.data;
}
