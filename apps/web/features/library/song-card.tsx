"use client";

import { usePlayer } from "@/features/player/player-context";
import SongMenu from "@/features/library/song-menu";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import { Pause, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type SongCardProps = {
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  path: string;
};

export default function SongCard({
  song_name,
  song_id,
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
}: SongCardProps) {
  const {
    song,
    isPlaying,
    togglePlayPause,
    playAudioSource,
    setQueue,
    setSongCallback,
    setCurrentSongIndex,
  } = usePlayer();
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageSrc = album_cover
    ? `${getBaseURL()}/media/images/${encodeURIComponent(album_cover)}`
    : defaultCover;
  const isActive = song?.id === song_id;
  const artist = { id: artist_id, name: artist_name };
  const album = { id: album_id, name: album_name, cover_url: album_cover };

  function handlePlay() {
    const songInfo = { id: song_id, name: song_name, artist: artist_name };
    setQueue([{ song: songInfo, album, artist }]);
    setCurrentSongIndex(0);
    setSongCallback(songInfo, artist, album);
    playAudioSource();
  }

  return (
    <div className="w-full min-w-0">
      <SongMenu
        context="home"
        song_name={song_name}
        song_id={song_id}
        artist_id={artist_id}
        artist_name={artist_name}
        album_id={album_id}
        album_name={album_name}
        album_cover={album_cover}
      >
        <div className="group min-w-0">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#111]">
            {!imageLoaded && (
              <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />
            )}
            <Image
              src={imageSrc}
              alt={song_name}
              fill
              sizes="(min-width: 1024px) 260px, 42vw"
              className={`cursor-pointer object-cover transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImageLoaded(true)}
              onError={(event) => {
                event.currentTarget.src = defaultCover;
                setImageLoaded(true);
              }}
              onClick={handlePlay}
            />
            <button
              className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-black opacity-100 shadow-lg transition-[opacity,transform] focus-visible:translate-y-0 focus-visible:opacity-100 md:translate-y-1 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                isActive ? togglePlayPause() : handlePlay();
              }}
              aria-label={isActive && isPlaying ? "Pause" : "Play"}
              type="button"
            >
              {isActive && isPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="ml-0.5 h-5 w-5 fill-current" />
              )}
            </button>
          </div>

          <div className="mt-3 min-w-0">
            <Link
              href={`/album?id=${album_id}`}
              className="block truncate text-sm font-semibold leading-5 text-zinc-100 hover:underline"
            >
              {song_name}
            </Link>
            <Link
              href={`/artist?id=${artist_id ?? "0"}`}
              className="block truncate text-sm leading-5 text-zinc-500 hover:text-zinc-200"
            >
              {artist_name}
            </Link>
          </div>
        </div>
      </SongMenu>
    </div>
  );
}
