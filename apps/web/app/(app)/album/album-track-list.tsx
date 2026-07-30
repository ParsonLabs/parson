"use client";

import type { LibraryAlbum } from "@parson/music-sdk";
import { Clock, Pause, Play } from "lucide-react";
import Link from "next/link";
import SongMenu from "@/features/library/song-menu";
import { displaySongTitle } from "@/features/library/song-presentation";
import { trackArtistCreditParts } from "@/features/library/track-artist-credit";

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export function AlbumTrackList({
  activeSongId,
  album,
  artistName,
  isPlaying,
  onPlay,
}: {
  activeSongId?: string;
  album: LibraryAlbum;
  artistName: string;
  isPlaying: boolean;
  onPlay: (track: LibraryAlbum["songs"][number]) => void;
}) {
  return (
    <div className="w-full pb-8">
      <div className="mb-2 grid grid-cols-[2rem_minmax(0,1fr)_3rem] gap-4 border-b border-white/10 px-4 py-2 text-sm font-medium text-zinc-500">
        <div className="text-center">#</div>
        <div>Track</div>
        <div className="flex justify-end text-right">
          <Clock className="h-4 w-4" />
        </div>
      </div>
      <div className="flex flex-col space-y-1">
        {album.songs.map((track, index) => {
          const active = activeSongId === track.id;
          const artistCredit = trackArtistCreditParts({
            albumArtist: artistName,
            albumType: album.primary_type,
            contributingArtists: track.contributing_artists,
            contributingArtistIds: track.contributing_artist_ids,
            trackArtist: track.artist,
          });
          const displayTitle = displaySongTitle(track.name);
          return (
            <SongMenu
              album_id={album.id}
              album_name={album.name}
              album_cover={album.cover_url}
              artist_id={album.artist_object.id}
              artist_name={artistName}
              context="album"
              key={track.id}
              song_id={track.id}
              song_name={track.name}
            >
              <div
                className={`group relative grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-4 rounded-md px-4 py-3 text-left text-sm transition-colors hover:bg-zinc-800/50 ${
                  active ? "bg-white/[0.02]" : ""
                }`}
              >
                <button
                  aria-label={`Play ${displayTitle}`}
                  className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
                  onClick={() => onPlay(track)}
                  type="button"
                />
                <div className="pointer-events-none relative z-10 text-center text-zinc-400">
                  <span className={active ? "block" : "group-hover:hidden"}>
                    {active ? (
                      <>
                        {isPlaying ? (
                          <Pause
                            aria-hidden="true"
                            className="mx-auto h-4 w-4 fill-white text-white"
                          />
                        ) : (
                          <Play
                            aria-hidden="true"
                            className="mx-auto h-4 w-4 fill-white text-white"
                          />
                        )}
                        <span className="sr-only">
                          {isPlaying ? "Now playing" : "Current track"}
                        </span>
                      </>
                    ) : (
                      track.track_number || index + 1
                    )}
                  </span>
                  {!active && (
                    <Play
                      aria-hidden="true"
                      className="absolute left-1/2 top-1/2 hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white group-hover:block"
                    />
                  )}
                </div>
                <div className="pointer-events-none relative z-10 flex min-w-0 flex-col pr-4 text-left">
                  <span className="truncate font-medium text-white">
                    {displayTitle}
                  </span>
                  {artistCredit && (
                    <span className="mt-0.5 truncate text-zinc-400">
                      {artistCredit[0]?.name}
                      {artistCredit.length > 1 && " feat. "}
                      {artistCredit.slice(1).map((credit, creditIndex) => (
                        <span
                          key={`${credit.id ?? credit.name}-${creditIndex}`}
                        >
                          {creditIndex > 0 && ", "}
                          {credit.id ? (
                            <Link
                              className="pointer-events-auto relative z-20 hover:text-white hover:underline"
                              href={`/artist?id=${credit.id}`}
                            >
                              {credit.name}
                            </Link>
                          ) : (
                            credit.name
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="pointer-events-none relative z-10 text-right tabular-nums text-zinc-400">
                  {formatDuration(track.duration)}
                </div>
              </div>
            </SongMenu>
          );
        })}
      </div>
    </div>
  );
}
