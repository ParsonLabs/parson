import type { Artist, LibrarySong } from "@parson/music-sdk/types";

const sameArtistName = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;

export function songCreditsArtist(
  song: Pick<
    LibrarySong,
    "artist" | "contributing_artist_ids" | "contributing_artists"
  >,
  artist: Pick<Artist, "id" | "name">,
) {
  return (
    sameArtistName(song.artist, artist.name) ||
    song.contributing_artist_ids.includes(artist.id) ||
    song.contributing_artists.some((name) => sameArtistName(name, artist.name))
  );
}
