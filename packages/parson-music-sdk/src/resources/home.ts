import api from "../core/http";
import type { ResponseSong } from "../domain/types";
import type { ResponseAlbum } from "../domain/types";

export interface HomeEssentials {
  continue_listening: ResponseSong[];
  recommended: ResponseSong[];
  shuffle: ResponseSong[];
  albums: ResponseAlbum[];
  stats: {
    song_count: number;
    album_count: number;
    artist_count: number;
  };
}

export async function getHomeEssentials(): Promise<HomeEssentials> {
  const res = await api.get("/home");
  return res.data;
}
