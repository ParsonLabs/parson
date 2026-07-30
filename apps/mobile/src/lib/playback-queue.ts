import type {
  Album,
  Artist,
  LibrarySong,
  PlaybackQueueSong,
} from "@parson/music-sdk";

const blankArtist = (): Artist => ({
  albums: [],
  description: "",
  featured_on_album_ids: [],
  followers: 0,
  icon_url: "",
  id: "",
  name: "",
});

const blankAlbum = (): Album => ({
  contributing_artists: [],
  contributing_artists_ids: [],
  cover_url: "",
  description: "",
  first_release_date: "",
  id: "",
  musicbrainz_id: "",
  name: "",
  primary_type: "",
  songs: [],
  wikidata_id: null,
});

export function playableQueueSongs(items: PlaybackQueueSong[]): LibrarySong[] {
  return items.flatMap((item) => {
    if (!item.id) return [];
    const artist = { ...blankArtist(), ...item.artist_object } as Artist;
    const album = { ...blankAlbum(), ...item.album_object } as Album;
    return [
      {
        album_id: album.id,
        album_object: album,
        artist: item.artist || artist.name,
        artist_id: artist.id,
        artist_object: artist,
        contributing_artist_ids: item.contributing_artist_ids ?? [],
        contributing_artists: item.contributing_artists ?? [],
        duration: Number(item.duration) || 0,
        id: item.id,
        name: item.name,
        path: "",
        track_number: Number(item.track_number) || 0,
      },
    ];
  });
}
