"use client";

import { usePlayer } from "@/components/Music/Player/usePlayer";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getSongInfo } from "@music/sdk";
import { Play, Pause, HeadphonesIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";

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
    playAudioSource,
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
  const isCurrentSong = playingSongID === song_id;
  const imageSrc = album_cover?.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;

  function formatDuration(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  }

  async function handlePlay() {
    setImageSrc(imageSrc);
    const songInfo = await getSongInfo(song_id);
    setSong(songInfo);
    setArtist({ id: artist_id, name: artist_name });
    setAlbum({ id: album_id, name: album_name, cover_url: album_cover });
    const audioSource = `${getBaseURL()}/api/stream/${encodeURIComponent(path)}?bitrate=0`;
    setAudioSource(audioSource);
    playAudioSource()
  }

  return (
    <motion.div 
      className={`grid grid-cols-[auto,1fr,auto] gap-4 items-center p-2.5 rounded-lg transition-all duration-200 ${
        isCurrentSong ? 'bg-white/15 backdrop-blur-sm' : 'hover:bg-white/10'
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      whileHover={{ x: 2 }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <div className="relative w-12 h-12 overflow-hidden rounded-md shadow-lg group">
        <div className={`absolute inset-0 bg-gradient-to-br from-purple-500/30 to-blue-500/30 ${isCurrentSong ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}></div>
        
        <Image
          src={imageSrc}
          alt={album_name}
          width={48}
          height={48}
          className={`rounded-md object-cover transition-all duration-300 ${
            (isHovered || isCurrentSong) ? 'scale-110 brightness-75' : ''
          }`}
        />
        
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: (isHovered || isCurrentSong) ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => isCurrentSong ? togglePlayPause() : handlePlay()}
          className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          whileTap={{ scale: 0.95 }}
        >
          <motion.div 
            className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-lg"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isCurrentSong ? (
              isPlaying ? (
                <Pause className="w-4 h-4 text-black fill-black" />
              ) : (
                <Play className="w-4 h-4 text-black fill-black translate-x-[1px]" />
              )
            ) : (
              <Play className="w-4 h-4 text-black fill-black translate-x-[1px]" />
            )}
          </motion.div>
        </motion.button>
      </div>

      <div className="min-w-0 flex flex-col">
        <div className={`font-medium truncate transition-colors duration-300 ${isCurrentSong ? 'text-white' : 'text-gray-200 group-hover:text-white'}`}>
          {song_name}
          {isCurrentSong && isPlaying && (
            <span className="inline-flex ml-2 items-center">
              <HeadphonesIcon className="h-3 w-3 text-purple-400 animate-pulse" />
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2 text-sm">
          <Link 
            href={`/artist?id=${artist_id}`}
            className="text-gray-400 hover:text-gray-200 hover:underline truncate transition-colors duration-200"
          >
            {artist_name}
          </Link>
          <span className="text-gray-600">•</span>
          <Link 
            href={`/album?id=${album_id}`}
            className="text-gray-400 hover:text-gray-200 hover:underline truncate transition-colors duration-200"
          >
            {album_name}
          </Link>
        </div>
      </div>

      <div className="text-sm text-gray-400 font-medium tabular-nums">
        {formatDuration(duration)}
      </div>
    </motion.div>
  );
}