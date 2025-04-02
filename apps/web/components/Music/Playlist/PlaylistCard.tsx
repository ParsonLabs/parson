import getBaseURL from "@/lib/Server/getBaseURL";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@music/ui/lib/utils";
import { useState } from "react";

type PlaylistCardProps = {
  song: LibrarySong,
  coverURL: string,
  artist: Artist,
  album: Album,
  showCover?: boolean,
  showArtist?: boolean,
  isActive?: boolean,
  className?: string
}

export default function PlaylistCard({ 
  song, 
  coverURL, 
  artist, 
  album, 
  showCover = true, 
  showArtist = true,
  isActive = false,
  className
}: PlaylistCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageUrl = coverURL ? `${getBaseURL()}/image/${encodeURIComponent(coverURL)}` : "/album-placeholder.png";
  
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {showCover && (
        <div className="relative w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 rounded-md overflow-hidden">
          <div className={cn(
            "absolute inset-0 bg-gradient-to-br from-neutral-700 to-neutral-900 animate-pulse", 
            imageLoaded ? "opacity-0" : "opacity-100"
          )} />
          
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ 
              opacity: imageLoaded ? 1 : 0, 
              scale: imageLoaded ? 1 : 0.95 
            }}
            transition={{ duration: 0.2 }}
            className="relative h-full w-full"
          >
            <Image
              src={imageUrl}
              alt={song.name + " Album Cover"}
              fill
              sizes="(max-width: 768px) 40px, 48px"
              className="object-cover shadow-md transition-all duration-300 group-hover:shadow-lg group-hover:brightness-110"
              onLoad={() => setImageLoaded(true)}
            />
            
            {isActive && (
              <div className="absolute inset-0 bg-green-500/20 border border-green-500/40" />
            )}
          </motion.div>
        </div>
      )}
      
      <div className="flex flex-col min-w-0 gap-1">
        <Link 
          onClick={(e) => e.stopPropagation()} 
          href={`/album?id=${album.id}`}
          className={cn(
            "text-sm sm:text-base hover:underline truncate font-medium transition-all duration-200",
            isActive ? "text-green-400" : "text-white"
          )}
        >
          <span className="truncate line-clamp-1">{song.name}</span>
        </Link>
        
        {showArtist && (
          <div className="flex items-center gap-1.5">
            <Link 
              onClick={(e) => e.stopPropagation()} 
              href={`/artist?id=${artist.id}`}
              className="text-neutral-400 text-xs sm:text-sm hover:text-white transition-colors truncate"
            >
              <span className="truncate line-clamp-1">{artist.name}</span>
            </Link>
            
            {album && (
              <>
                <span className="text-neutral-600 text-xs">•</span>
                <Link 
                  onClick={(e) => e.stopPropagation()} 
                  href={`/album?id=${album.id}`}
                  className="text-neutral-500 text-xs hover:text-neutral-300 transition-colors truncate max-w-[100px]"
                >
                  <span className="truncate line-clamp-1">{album.name}</span>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}