import type { CombinedItem, LibrarySong } from "@parson/music-sdk";

type CatalogSong = {
  id: string;
  name: string;
  artistId?: string;
  artistName: string;
  albumId?: string;
  albumName: string;
  coverPath?: string;
  duration?: number;
  path?: string;
};

export function playableCatalogSong(song: CatalogSong): LibrarySong {
  const artistId = song.artistId ?? "";
  const albumId = song.albumId ?? "";
  return {
    id: song.id,
    album_id: albumId,
    artist_id: artistId,
    name: song.name,
    artist: song.artistName,
    contributing_artists: [],
    contributing_artist_ids: [],
    track_number: 0,
    path: song.path ?? "",
    duration: song.duration ?? 0,
    artist_object: {
      id: artistId,
      name: song.artistName,
      icon_url: "",
      followers: 0,
      albums: [],
      featured_on_album_ids: [],
      description: "",
    },
    album_object: {
      id: albumId,
      name: song.albumName,
      cover_url: song.coverPath ?? "",
      songs: [],
      first_release_date: "",
      musicbrainz_id: "",
      wikidata_id: null,
      primary_type: "Album",
      description: "",
      contributing_artists: [],
      contributing_artists_ids: [],
    },
  };
}

export function playableSearchSong(item: CombinedItem): LibrarySong {
  return playableCatalogSong({
    id: item.id,
    name: item.song_object?.name ?? item.name,
    duration: item.song_object?.duration,
    path: item.song_object?.path,
    artistId: item.artist_object?.id,
    artistName: item.artist_object?.name ?? "Unknown artist",
    albumId: item.album_object?.id,
    albumName: item.album_object?.name ?? "Unknown album",
    coverPath: item.album_object?.cover_url,
  });
}
