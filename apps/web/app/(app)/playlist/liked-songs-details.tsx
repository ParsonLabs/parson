"use client";

import { Button } from "@/components/ui/button";
import { usePlayer } from "@/features/player/player-context";
import {
  getFavoriteSongDetails,
  removeFavoriteSong,
  type FavoriteSongDetail,
} from "@parson/music-sdk";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { ArrowLeft, Heart, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { toast } from "sonner";
import { PlaylistPlaybackActions, PlaylistTracks } from "./playlist-components";
import { formatPlaylistDuration } from "./playlist-duration";
import { likedSongsOldestFirst } from "./liked-songs-order";
import { shuffledIndices } from "./playlist-playback";

const PAGE_SIZE = 200;
const favoriteDetailsKey = ["favorite-song-details"] as const;
type FavoriteCursor =
  { before_added_at: string; before_song_id: string } | undefined;

export default function LikedSongsDetails() {
  const player = usePlayer();
  const queryClient = useQueryClient();
  const favorites = useInfiniteQuery({
    queryKey: favoriteDetailsKey,
    initialPageParam: undefined as FavoriteCursor,
    queryFn: ({ pageParam }) =>
      getFavoriteSongDetails({
        limit: PAGE_SIZE,
        ...pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage.at(-1);
      return last
        ? {
            before_added_at: last.added_at,
            before_song_id: last.song_id,
          }
        : undefined;
    },
  });
  const songs = favorites.data
    ? likedSongsOldestFirst(favorites.data.pages)
    : [];

  useEffect(() => {
    if (favorites.hasNextPage && !favorites.isFetchingNextPage) {
      void favorites.fetchNextPage();
    }
  }, [
    favorites.fetchNextPage,
    favorites.hasNextPage,
    favorites.isFetchingNextPage,
  ]);

  const remove = useMutation({
    mutationFn: removeFavoriteSong,
    onSuccess: (_result, songId) => {
      queryClient.setQueryData(["favorite-membership", songId], false);
      queryClient.setQueryData<
        InfiniteData<FavoriteSongDetail[], FavoriteCursor>
      >(favoriteDetailsKey, (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) =>
                page.filter((item) => item.song_id !== songId),
              ),
            }
          : current,
      );
      toast.success("Removed from Liked Songs");
    },
    onError: () => toast("Could not remove this song from Liked Songs."),
  });

  const playFrom = (index: number) => {
    const selected = songs[index];
    if (!selected) return;
    player.setQueue(
      songs.map((song) => ({
        song,
        artist: song.artist_object,
        album: song.album_object,
      })),
    );
    player.setCurrentSongIndex(index);
    if (player.song.id === selected.id) {
      player.togglePlayPause();
      return;
    }
    player.setSongCallback(
      selected,
      selected.artist_object,
      selected.album_object,
    );
    player.playAudioSource();
  };

  const shuffle = () => {
    const order = shuffledIndices(songs.length);
    const firstIndex = order[0];
    if (firstIndex === undefined) return;
    const shuffled = order.map((index) => songs[index]!);
    const selected = shuffled[0]!;
    player.setQueue(
      shuffled.map((song) => ({
        song,
        artist: song.artist_object,
        album: song.album_object,
      })),
    );
    player.setCurrentSongIndex(0);
    player.setSongCallback(
      selected,
      selected.artist_object,
      selected.album_object,
    );
    player.playAudioSource();
  };

  if (favorites.isPending) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-zinc-500">
        <span className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading Liked Songs…
        </span>
      </div>
    );
  }

  if (favorites.isError) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Liked Songs unavailable
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Parson could not load your saved songs. Your likes are still safe.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => void favorites.refetch()} variant="outline">
              Try again
            </Button>
            <Button asChild variant="ghost">
              <Link
                className="select-none"
                draggable={false}
                href="/library?view=playlists"
                onDragStart={(event) => event.preventDefault()}
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Playlists
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const totalDuration = songs.reduce(
    (total, song) => total + (song.duration || 0),
    0,
  );

  return (
    <section className="mx-auto w-full max-w-[1000px] px-5 py-9 pb-36 sm:px-7">
      <Link
        className="inline-flex select-none items-center gap-2 text-sm text-zinc-500 hover:text-white"
        draggable={false}
        href="/library?view=playlists"
        onDragStart={(event) => event.preventDefault()}
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Playlists
      </Link>
      <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="grid h-40 w-40 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-fuchsia-800 text-white shadow-2xl shadow-black sm:h-48 sm:w-48">
          <Heart className="h-16 w-16 fill-current sm:h-20 sm:w-20" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-4xl font-black text-white sm:text-5xl">
            Liked Songs
          </h1>
          <p className="mt-3 text-sm text-zinc-500">
            {songs.length} {songs.length === 1 ? "song" : "songs"} ·{" "}
            {formatPlaylistDuration(totalDuration)}
          </p>
        </div>
      </header>

      <div className="mt-8 flex items-center gap-3">
        <PlaylistPlaybackActions
          hasTracks={songs.length > 0}
          name="Liked Songs"
          onPlay={() => playFrom(0)}
          onShuffle={shuffle}
        />
      </div>
      <PlaylistTracks
        activeSongId={player.song.id}
        emptyBody="Use the heart in the player or any song menu to keep music you love close."
        emptyTitle="Songs you love, all in one place"
        isPlaying={player.isPlaying}
        onPlay={playFrom}
        onRemove={(songId) => remove.mutate(songId)}
        removeLabel="Remove from Liked Songs"
        tracks={songs}
      />
    </section>
  );
}
