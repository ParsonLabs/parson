"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";

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
  const albumCoverURL = (!album_cover || album_cover.length === 0) ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;
  let releaseDate = new Date(first_release_date).toLocaleString('default', { year: 'numeric' });

  const { setGradient } = useGradientHover();
  const [dominantColor, setDominantColor] = useState<string | null>(null);

  useEffect(() => {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const color = await fac.getColorAsync(albumCoverURL);
      setDominantColor(color.hex);
    };
    getColor();
  }, [albumCoverURL]);

  function handleMouseEnter() {
    if (dominantColor) {
      setGradient(dominantColor);
    }
  }

  return (
    <div className="w-44 h-44 relative group" onMouseEnter={handleMouseEnter}>
      {dominantColor && (
        <div
          className="relative top-0 w-11/12 justify-center h-2 rounded-t-lg z-10 group-hover:brightness-50 duration-300 transition-filter"
          style={{ backgroundColor: dominantColor, margin: '0 auto', marginBottom: '2px' }}
        />
      )}
      <Link href={`/album?id=${album_id}`}>
        <Image src={albumCoverURL} alt={`${album_name} Image`} height={256} width={256} className="rounded cursor-pointer transition-filter duration-300 group-hover:brightness-50 object-fill w-full h-40" style={{ height: "167px" }}/>
        <div className="mt-3 font-bold text-white flex justify-between overflow-hidden">
          <p className="overflow-hidden text-ellipsis whitespace-nowrap" title={album_name}>{album_name}</p>
          <p className="ml-2 font-light text-gray-400 whitespace-nowrap">{album_songs_count}</p>
        </div>
      </Link>
  
      <Link href={`/artist?id=${artist_id}`}>
        <p className="text-gray-400">
          {artist_name} • {releaseDate}
        </p>
      </Link>
    </div>
  );
}