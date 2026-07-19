"use client";

import {
  addFavoriteSong,
  isFavoriteSong,
  removeFavoriteSong,
} from "@parson/music-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Loader2 } from "lucide-react";

const favoriteSongDetailsKey = ["favorite-song-details"] as const;

export function useFavoriteSong(songId: string, enabled = true) {
  const queryClient = useQueryClient();
  const membershipKey = ["favorite-membership", songId] as const;
  const membership = useQuery({
    queryKey: membershipKey,
    queryFn: () => isFavoriteSong(songId),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
  const liked = membership.data ?? false;
  const mutation = useMutation({
    mutationFn: async (nextLiked: boolean) => {
      if (nextLiked) await addFavoriteSong(songId);
      else await removeFavoriteSong(songId);
      return nextLiked;
    },
    onMutate: async (nextLiked) => {
      await queryClient.cancelQueries({ queryKey: membershipKey });
      const previous = queryClient.getQueryData<boolean>(membershipKey);
      queryClient.setQueryData(membershipKey, nextLiked);
      return { previous };
    },
    onError: (_error, _nextLiked, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(membershipKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: membershipKey });
      void queryClient.invalidateQueries({
        queryKey: favoriteSongDetailsKey,
      });
    },
  });

  return {
    error: membership.error ?? mutation.error,
    liked,
    checking: enabled && membership.isPending,
    loading: mutation.isPending,
    toggle: () => mutation.mutate(!liked),
  };
}

export default function FavoriteButton({
  className = "",
  songId,
  songName,
}: {
  className?: string;
  songId: string;
  songName?: string;
}) {
  const favorite = useFavoriteSong(songId);
  const target = songName ? ` ${songName}` : "";
  return (
    <button
      aria-label={
        favorite.liked
          ? `Remove${target} from Liked Songs`
          : `Add${target} to Liked Songs`
      }
      aria-pressed={favorite.liked}
      className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
        favorite.liked
          ? "text-rose-400 hover:bg-rose-400/10"
          : "text-zinc-500 hover:bg-white/10 hover:text-white"
      } ${className}`}
      disabled={favorite.loading}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        favorite.toggle();
      }}
      title={
        favorite.error ? "Could not update Liked Songs. Try again." : undefined
      }
      type="button"
    >
      {favorite.loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart
          className={`h-4 w-4 ${favorite.liked ? "fill-current" : ""} ${favorite.checking ? "opacity-60" : ""}`}
        />
      )}
    </button>
  );
}
