"use client";

import { usePlayer } from "@/components/Music/Player/usePlayer";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getSongInfo } from "@music/sdk";
import { Play, Pause, Volume2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type SongRowProps = {
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  path: string;
  duration: number;
};

export default function SongRow({
  song_name,
  song_id,
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
  path,
  duration,
}: SongRowProps) {
  const {
    setImageSrc,
    setAudioSource,
    setSong,
    setArtist,
    setAlbum,
    song,
    isPlaying,
    volume,
    togglePlayPause,
  } = usePlayer();

  const [isHovered, setIsHovered] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  const playingSongID = song?.id;
  const imageSrc = album_cover?.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;

  function formatDuration(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  }

  async function handlePlay() {
    setImageSrc(imageSrc);
    setArtist({ id: artist_id, name: artist_name });
    setAlbum({ id: album_id, name: album_name, cover_url: album_cover });
    const songInfo = await getSongInfo(song_id);
    setSong(songInfo);
    setAudioSource(`${getBaseURL()}/api/stream/${encodeURIComponent(path)}`);
  }

  return (
    <div 
      className="grid grid-cols-[auto,1fr,auto] gap-4 items-center p-2 rounded-lg group hover:bg-white/10 transition-colors"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative w-12 h-12">
        <Image
          src={imageSrc}
          alt={album_name}
          width={48}
          height={48}
          className="rounded object-cover"
        />
        {(isHovered || playingSongID === song_id) && (
          <button
            onClick={() => playingSongID === song_id ? togglePlayPause() : handlePlay()}
            className="absolute inset-0 flex items-center justify-center bg-black/40"
          >
            {playingSongID === song_id ? (
              isPlaying ? (
                <Pause className="w-6 h-6 text-white" />
              ) : (
                <Play className="w-6 h-6 text-white" />
              )
            ) : (
              <Play className="w-6 h-6 text-white" />
            )}
          </button>
        )}
      </div>

      <div className="min-w-0">
        <div className="text-white font-medium truncate">
          {song_name}
        </div>
        <Link 
          href={`/album?id=${album_id}`}
          className="text-sm text-gray-400 hover:underline truncate block"
        >
          {album_name}
        </Link>
      </div>

      <div className="text-sm text-gray-400">
        {formatDuration(duration)}
      </div>
    </div>
  );
}