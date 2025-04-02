"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";

type AlbumCardProps = {
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  album_songs_count: number;
  first_release_date: string;
};

export default function AlbumCard({
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
  album_songs_count,
  first_release_date,
}: AlbumCardProps) {
  const albumCoverURL = (!album_cover || album_cover.length === 0) 
    ? "/snf.png" 
    : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;
    
  let releaseDate = new Date(first_release_date).toLocaleString('default', { year: 'numeric' });

  const { setGradient } = useGradientHover();
  const [dominantColor, setDominantColor] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    const fac = new FastAverageColor();
    const getColor = async () => {
      try {
        const color = await fac.getColorAsync(albumCoverURL);
        setDominantColor(color.hex);
      } catch (error) {
        console.error("Failed to get dominant color:", error);
      }
    };
    getColor();
  }, [albumCoverURL]);

  function handleMouseEnter() {
    if (dominantColor) {
      setGradient(dominantColor);
      setIsHovered(true);
    }
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative group w-[250px]"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setIsHovered(false)}
    >
      {dominantColor && (
        <div
          className="relative top-0 w-11/12 justify-center h-2 rounded-t-lg z-10 transition-all duration-300"
          style={{ 
            backgroundColor: dominantColor, 
            margin: '0 auto', 
            marginBottom: '2px',
            opacity: isHovered ? 1 : 0.7
          }}
        />
      )}
      
      <Link href={`/album?id=${album_id}`}>
        <div className="relative w-full aspect-square overflow-hidden rounded-2xl shadow-xl bg-black/20 backdrop-blur-sm transform transition-all duration-300 hover:-translate-y-1">
          {!imageLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 animate-pulse"></div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          
          <Image 
            src={albumCoverURL} 
            alt={`${album_name} Image`} 
            height={800} 
            width={800} 
            onLoad={() => setImageLoaded(true)}
            className={`object-cover w-full h-full transition-all duration-500 ${
              isHovered ? "scale-110 brightness-90" : "scale-100 brightness-95"
            }`}
          />
          
          <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-md px-2 py-1 rounded-full text-xs font-medium">
            {album_songs_count} {album_songs_count === 1 ? 'song' : 'songs'}
          </div>
        </div>
      </Link>
      
      <div className="mt-4 w-full px-1 overflow-hidden">
        <p className="font-semibold text-base text-white truncate" title={album_name}>
          <Link href={`/album?id=${album_id}`} className="hover:underline underline-offset-2 transition-all">
            {album_name}
          </Link>
        </p>
        
        <div className="flex items-center justify-between mt-0.5">
          <Link 
            href={`/artist?id=${artist_id}`} 
            className="text-sm text-gray-400 hover:text-white transition-colors truncate block"
          >
            {artist_name}
          </Link>
          
          {releaseDate !== "Invalid Date" && (
            <span className="text-xs text-gray-500 whitespace-nowrap ml-1">
              • {releaseDate}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}