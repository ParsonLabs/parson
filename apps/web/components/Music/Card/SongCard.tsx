"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import { Play, Pause, Volume2, MoreHorizontal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePlayer } from "../Player/usePlayer";
import SongContextMenu from "../SongContextMenu";
import { getSongInfo } from "@music/sdk";
import { useSession } from "@/components/Providers/AuthProvider";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

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
  path,
}: SongCardProps) {
  const {
    setImageSrc,
    setAudioSource,
    setSong,
    setArtist,
    setAlbum,
    setPlayedFromAlbum,
    song,
    isPlaying,
    volume,
    togglePlayPause,
    playAudioSource
  } = usePlayer();

  const playingSongID = song?.id;

  const { session } = useSession();

  const artist = { id: artist_id, name: artist_name };
  const album = { id: album_id, name: album_name, cover_url: album_cover };

  let imageSrc =
    album_cover?.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;

  let songURL = `${getBaseURL()}/api/stream/${encodeURIComponent(
    path
  )}?bitrate=${(session && session.bitrate) || 0}`;

  async function handlePlay() {
    setImageSrc(imageSrc);
    setArtist(artist);
    setAlbum(album);
    try {
      const songInfo = await getSongInfo(song_id);
      setSong(songInfo);
      setAudioSource(songURL);
      setPlayedFromAlbum(false);
      playAudioSource()
    } catch (error) {
      console.error("Failed to fetch song info:", error);
    }
  }

  const { setGradientWithTransition } = useGradientHover();
  const [colorExtracted, setColorExtracted] = useState(false);

  function setDominantGradient() {
    if (colorExtracted) return;
    
    const fac = new FastAverageColor();
    const getColor = async () => {
      try {
        const color = await fac.getColorAsync(imageSrc);
        setGradientWithTransition(color.hex);
        setColorExtracted(true);
      } catch (error) {
        console.error("Failed to get dominant color:", error);
      }
    };
    getColor();
  }

  const [isHovered, setIsHovered] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  const isActive = playingSongID === song_id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative group w-[250px] h-[300px] flex flex-col"
      onMouseEnter={() => {
        setDominantGradient();
        setIsHovered(true);
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SongContextMenu
        song_name={song_name}
        song_id={song_id}
        artist_id={artist_id}
        artist_name={artist_name}
        album_id={album_id}
        album_name={album_name}
      >
        <div className="relative w-full aspect-square overflow-hidden rounded-2xl shadow-xl bg-black/20 backdrop-blur-sm transform transition-all duration-300 hover:-translate-y-1">
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          
          {!imageLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 animate-pulse"></div>
          )}
          
          <Image
            src={imageSrc}
            alt={song_name}
            height={800}
            width={800}
            loading="lazy"
            className={`object-cover w-full h-full transition-all duration-500 ${
              isHovered ? "scale-110 brightness-100" : "scale-100 brightness-95"
            } ${isActive ? "brightness-90" : ""}`}
            onLoad={() => setImageLoaded(true)}
            onClick={handlePlay}
          />
          
          <motion.button 
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ 
              opacity: isHovered || isActive ? 1 : 0,
              scale: isHovered || isActive ? 1 : 0.8
            }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-3 right-3 rounded-full bg-white/90 shadow-lg hover:bg-white hover:shadow-xl active:scale-95 transition-all"
            onClick={(e) => {
              e.stopPropagation();
              isActive ? togglePlayPause() : handlePlay();
            }}
            aria-label={isActive && isPlaying ? "Pause" : "Play"}
          >
            <div className="w-10 h-10 flex items-center justify-center">
              {isActive && isPlaying ? (
                <Pause className="w-5 h-5 text-black fill-black" />
              ) : (
                <Play className="w-5 h-5 text-black ml-0.5 fill-black" />
              )}
            </div>
          </motion.button>
          
          {isActive && (
            <div className="absolute bottom-3 left-3 flex">
              <div className="flex gap-1.5 px-3 py-1.5 bg-black/50 backdrop-blur-md rounded-full">
                <motion.div 
                  animate={{ height: ["6px", "14px", "6px"] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                  className="w-1 bg-white rounded-full"
                ></motion.div>
                <motion.div 
                  animate={{ height: ["6px", "18px", "6px"] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                  className="w-1 bg-white rounded-full"
                ></motion.div>
                <motion.div 
                  animate={{ height: ["6px", "12px", "6px"] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                  className="w-1 bg-white rounded-full"
                ></motion.div>
              </div>
            </div>
          )}
        </div>
      </SongContextMenu>
  
      <div className="mt-4 w-full px-1 overflow-hidden">
        <p className="font-semibold text-base text-white truncate" title={song_name}>
          <Link href={`/album?id=${album_id}`} className="hover:underline underline-offset-2 transition-all">
            {song_name}
          </Link>
        </p>
        <Link 
          href={`/artist?id=${artist_id ?? "0"}`} 
          className="text-sm text-gray-400 hover:text-white transition-colors truncate block mt-0.5"
        >
          {artist_name}
        </Link>
      </div>
      
      <motion.div 
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all"
        animate={{ opacity: isHovered ? 1 : 0 }}
      >
        <motion.button 
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          className="p-2 bg-black/50 backdrop-blur-md rounded-full hover:bg-black/70 transition-colors shadow-lg"
        >
          <MoreHorizontal className="w-4 h-4 text-white" />
        </motion.button>
      </motion.div>
    </motion.div>
  );
}