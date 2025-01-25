import getBaseURL from "@/lib/Server/getBaseURL";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

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
      <div 
        className="group relative aspect-square rounded-lg overflow-hidden"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Image
          src={coverUrl}
          alt={album_name}
          layout="fill"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          priority
        />
        <div 
          className={`absolute inset-0 bg-black/60 flex flex-col justify-end p-4 transition-opacity duration-300
            ${isHovered ? 'opacity-100' : 'opacity-0'}`}
        >
          <h3 className="text-white font-medium truncate">{album_name}</h3>
          {year && (
            <span className="text-sm text-gray-300">{year}</span>
          )}
        </div>
      </div>
    </Link>
  );
}