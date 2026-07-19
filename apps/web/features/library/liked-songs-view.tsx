"use client";

import SongMenu from "@/features/library/song-menu";
import { usePlayer } from "@/features/player/player-context";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import type { LibrarySong } from "@parson/music-sdk";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  InfiniteLoad,
  LibraryLoading,
  LibraryMessage,
} from "./library-view-primitives";

export default function LikedSongsView({
  error,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
  onRetry,
  songs,
}: {
  error: boolean;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  songs: LibrarySong[];
}) {
  const player = usePlayer();
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
    player.setSongCallback(
      selected,
      selected.artist_object,
      selected.album_object,
    );
    player.playAudioSource();
  };

  if (loading) return <LibraryLoading compact />;
  if (error) {
    return (
      <LibraryMessage
        action="Try again"
        body="Parson could not load your saved songs. Your likes are still safe."
        onAction={onRetry}
        title="Liked Songs unavailable"
      />
    );
  }
  if (!songs.length) {
    return (
      <LibraryMessage
        body="Use the heart in the player or any song menu to keep music you love close."
        title="Songs you love, all in one place"
      />
    );
  }
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        {songs.map((song, index) => (
          <SongMenu
            album_id={song.album_object.id}
            album_name={song.album_object.name}
            album_cover={song.album_object.cover_url}
            artist_id={song.artist_object.id}
            artist_name={song.artist_object.name}
            key={song.id}
            song_id={song.id}
            song_name={song.name}
          >
            <div className="group relative grid grid-cols-[2rem_2.5rem_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.06] px-3 py-2 last:border-0 hover:bg-white/[0.035] sm:grid-cols-[2rem_2.5rem_minmax(0,1fr)_minmax(8rem,0.6fr)]">
              <button
                aria-label={`Play ${song.name}`}
                className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
                onClick={() => playFrom(index)}
                type="button"
              />
              <span className="pointer-events-none relative z-10 text-center text-sm tabular-nums text-zinc-500">
                {index + 1}
              </span>
              <div className="pointer-events-none relative z-10 h-10 w-10 overflow-hidden rounded-md bg-zinc-900">
                <Image
                  alt=""
                  className="object-cover transition-opacity group-hover:opacity-40"
                  fill
                  sizes="40px"
                  src={
                    song.album_object.cover_url
                      ? `${getBaseURL()}/media/images/${encodeURIComponent(song.album_object.cover_url)}`
                      : defaultCover
                  }
                />
                <Play className="absolute left-1/2 top-1/2 hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white group-hover:block" />
              </div>
              <div className="pointer-events-none relative z-10 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {song.name}
                </p>
                <Link
                  className="pointer-events-auto relative z-20 text-xs text-zinc-500 hover:text-white hover:underline"
                  href={`/artist?id=${song.artist_object.id}`}
                >
                  {song.artist_object.name}
                </Link>
              </div>
              <Link
                className="relative z-20 hidden truncate text-sm text-zinc-500 hover:text-white hover:underline sm:block"
                href={`/album?id=${song.album_object.id}`}
              >
                {song.album_object.name}
              </Link>
            </div>
          </SongMenu>
        ))}
      </div>
      <InfiniteLoad
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  );
}
