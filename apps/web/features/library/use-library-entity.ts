"use client";

import {
  getAlbumInfo,
  getArtistInfo,
  type LibraryAlbum,
} from "@parson/music-sdk";
import type { Artist } from "@parson/music-sdk/types";
import { useQuery } from "@tanstack/react-query";

export function useAlbum(id: string | null, initial?: LibraryAlbum) {
  return useQuery({
    queryKey: ["albums", id],
    queryFn: () => getAlbumInfo(id!, false) as Promise<LibraryAlbum>,
    enabled: Boolean(id) && !initial,
    initialData: initial,
  });
}

export function useArtist(id: string | null, initial?: Artist) {
  return useQuery({
    queryKey: ["artists", id],
    queryFn: () => getArtistInfo(id!),
    enabled: Boolean(id) && !initial,
    initialData: initial,
  });
}
