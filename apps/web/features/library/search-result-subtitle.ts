import type { CombinedItem } from "@parson/music-sdk/types";
import { trackArtistCredit } from "./track-artist-credit";

export type SearchResultSubtitle = {
  artist?: string;
  label?: string;
};

function isEdition(primaryType?: string) {
  const value = primaryType?.trim().toLocaleLowerCase() ?? "";
  return value === "edition" || value.endsWith(" edition");
}

export function searchResultSubtitle(
  item: Pick<
    CombinedItem,
    "album_object" | "artist_object" | "item_type" | "song_object"
  >,
): SearchResultSubtitle {
  const artist = item.artist_object?.name?.trim() || undefined;
  switch (item.item_type) {
    case "artist":
      return { label: "Artist" };
    case "song":
      return {
        artist:
          trackArtistCredit({
            albumArtist: artist ?? "",
            albumType: item.album_object?.primary_type ?? "",
            contributingArtists: item.song_object?.contributing_artists ?? [],
            trackArtist: item.song_object?.artist ?? artist ?? "",
          }) ??
          item.song_object?.artist?.trim() ??
          artist,
        label: "Song",
      };
    case "album":
      return {
        artist,
        label: isEdition(item.album_object?.primary_type) ? "Edition" : "Album",
      };
    case "edition":
      return { artist, label: "Edition" };
    case "playlist":
      return { label: "Playlist" };
    default:
      return { label: item.item_type };
  }
}

export function searchResultIsPlayable(itemType: string) {
  return itemType === "song" || itemType === "album";
}
