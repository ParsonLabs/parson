import getBaseURL from "@/lib/Server/getBaseURL";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";

type AlbumCardProps = {
  album_id: string;
  album_name: string;
  album_cover: string;
  first_release_date?: string;
};

export default function ArtistAlbumCard({ 
  album_id, 
  album_name, 
  album_cover,
  first_release_date 
}: AlbumCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  const coverUrl = album_cover.length === 0 
    ? "/snf.png" 
    : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}?raw=true`;

  const year = first_release_date 
    ? new Date(first_release_date).getFullYear() 
    : null;

  return (
    <Link href={`/album?id=${album_id}`}>
      <motion.div 
        className="relative aspect-square rounded-lg overflow-hidden shadow-md bg-black/20 backdrop-blur-sm border border-white/5"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        whileHover={{ y: -6 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <Image
          src={coverUrl}
          alt={album_name}
          layout="fill"
          className={`object-cover transition-all duration-500 ${isHovered ? 'scale-110 brightness-90' : 'scale-100'}`}
          priority
        />
        
        <div 
          className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity duration-300 ${isHovered ? 'opacity-100' : ''}`}
        />
        
        <motion.div
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: isHovered ? 1 : 0, scale: isHovered ? 1 : 0.8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="w-12 h-12 bg-white/80 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg">
            <Play className="w-5 h-5 text-black fill-black ml-1" fill="black" />
          </div>
        </motion.div>
        
        <motion.div 
          className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-4 z-10"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: isHovered ? 0 : 10, opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <h3 className="text-white font-semibold text-lg truncate drop-shadow-md">{album_name}</h3>
          {year && (
            <div className="flex items-center mt-1">
              <span className="text-sm text-white/70 font-medium backdrop-blur-sm bg-black/20 px-2 py-0.5 rounded-full">{year}</span>
            </div>
          )}
        </motion.div>
        
        <motion.div 
          className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: isHovered ? 1 : 0 }}
          transition={{ duration: 0.3 }}
        />
      </motion.div>
    </Link>
  );
}