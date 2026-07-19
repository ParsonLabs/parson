"use client";

import {
  getHomeEssentials,
  getLibraryUnavailable,
  type HomeEssentials,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";

export const emptyLibraryFeed: HomeEssentials = {
  continue_listening: [],
  recommended: [],
  shuffle: [],
  albums: [],
  stats: { song_count: 0, album_count: 0, artist_count: 0 },
};

export function useLibraryFeed(enabled = true) {
  return useQuery({
    queryKey: ["library", "feed"],
    queryFn: getHomeEssentials,
    enabled,
    refetchInterval: (query) =>
      getLibraryUnavailable(query.state.error)?.state === "indexing"
        ? 2_500
        : false,
  });
}
