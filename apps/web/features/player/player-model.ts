import type { PlaybackQueueSong } from "@parson/music-sdk";
import type { Album, Artist, LibrarySong } from "@parson/music-sdk/types";

export type PlayerInput = Partial<
  Omit<LibrarySong, "album_object" | "artist_object">
> & {
  album_object?: Partial<Album>;
  artist_object?: Partial<Artist>;
};

export type QueueInput = {
  song: PlayerInput;
  album?: Partial<Album>;
  artist?: Partial<Artist>;
};

export type QueueOrigin = "manual" | "generated";

export type QueueItem = {
  song: LibrarySong;
  album: Album;
  artist: Artist;
  origin: QueueOrigin;
  queuePosition: number | null;
};

export function blankArtist(): Artist {
  return {
    id: "",
    name: "",
    icon_url: "",
    followers: 0,
    albums: [],
    featured_on_album_ids: [],
    description: "",
  };
}

export function blankAlbum(): Album {
  return {
    id: "",
    name: "",
    cover_url: "",
    songs: [],
    first_release_date: "",
    musicbrainz_id: "",
    wikidata_id: null,
    primary_type: "",
    description: "",
    contributing_artists: [],
    contributing_artists_ids: [],
  };
}

export function blankSong(): LibrarySong {
  return {
    id: "",
    name: "",
    artist: "",
    contributing_artists: [],
    contributing_artist_ids: [],
    track_number: 0,
    path: "",
    duration: 0,
    artist_object: blankArtist(),
    album_object: blankAlbum(),
  };
}

export function normalizeSong(
  value: PlayerInput,
  artist?: Partial<Artist>,
  album?: Partial<Album>,
): LibrarySong {
  const base = blankSong();
  const nextAlbum = {
    ...base.album_object,
    ...(value.album_object ?? {}),
    ...(album ?? {}),
  } as Album;
  const nextArtist = {
    ...base.artist_object,
    ...(value.artist_object ?? {}),
    ...(artist ?? {}),
  } as Artist;

  return {
    ...base,
    ...value,
    id: String(value.id ?? ""),
    name: String(value.name ?? ""),
    path: String(value.path ?? ""),
    artist: String(value.artist ?? nextArtist.name),
    duration: Number(value.duration ?? 0),
    track_number: Number(value.track_number ?? 0),
    contributing_artists: value.contributing_artists ?? [],
    contributing_artist_ids: value.contributing_artist_ids ?? [],
    album_object: nextAlbum,
    artist_object: nextArtist,
  } as LibrarySong;
}

export function manualQueueItems(items: QueueInput[]): QueueItem[] {
  return items.map((item) => {
    const song = normalizeSong(item.song, item.artist, item.album);
    return {
      song,
      artist: song.artist_object,
      album: song.album_object,
      origin: "manual",
      queuePosition: null,
    };
  });
}

export function persistedQueueItems(items: PlaybackQueueSong[]): QueueItem[] {
  return items.map((item) => {
    const song = normalizeSong(item, item.artist_object, item.album_object);
    return {
      song,
      artist: song.artist_object,
      album: song.album_object,
      origin: item.origin,
      queuePosition: item.queue_position,
    };
  });
}
