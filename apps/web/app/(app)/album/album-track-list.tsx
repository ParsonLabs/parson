"use client";

import type { LibraryAlbum } from "@parson/music-sdk";
import { Clock, Play } from "lucide-react";
import SongMenu from "@/features/library/song-menu";

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.round(duration % 60);
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export function AlbumTrackList({
  activeSongId,
  album,
  artistName,
  onPlay,
}: {
  activeSongId?: string;
  album: LibraryAlbum;
  artistName: string;
  onPlay: (track: LibraryAlbum["songs"][number]) => void;
}) {
  return (
    <div className="w-full pb-8">
      <div className="mb-2 grid grid-cols-[auto_1fr_auto] gap-4 border-b border-white/10 px-4 py-2 text-sm font-medium text-zinc-500">
        <div className="w-8 text-center">#</div>
        <div>Title</div>
        <div className="w-12 text-right flex justify-end">
          <Clock className="w-4 h-4" />
        </div>
      </div>
      <div className="flex flex-col space-y-1">
        {album.songs.map((track, index) => {
          const active = activeSongId === track.id;
          return (
            <SongMenu
              album_id={album.id}
              album_name={album.name}
              album_cover={album.cover_url}
              artist_id={album.artist_object.id}
              artist_name={artistName}
              key={track.id}
              song_id={track.id}
              song_name={track.name}
            >
              <div className="group grid grid-cols-[auto_1fr_auto] gap-4 px-4 py-3 hover:bg-zinc-800/50 rounded-md transition-colors items-center text-sm text-left">
                <button
                  aria-label={`Play ${track.name}`}
                  className="w-8 text-center text-zinc-400 relative"
                  onClick={() => onPlay(track)}
                  type="button"
                >
                  <span className="group-hover:hidden">
                    {track.track_number || index + 1}
                  </span>
                  <Play className="w-4 h-4 fill-white text-white absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hidden group-hover:block" />
                </button>
                <button
                  className="flex flex-col pr-4 text-left"
                  onClick={() => onPlay(track)}
                  type="button"
                >
                  <span
                    className={`font-medium ${active ? "text-primary" : "text-white"}`}
                  >
                    {track.name}
                  </span>
                  <span className="text-zinc-400 mt-0.5">{artistName}</span>
                </button>
                <div className="w-12 text-right text-zinc-400">
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
