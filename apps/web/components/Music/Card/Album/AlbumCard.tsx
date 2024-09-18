"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import Link from "next/link";

type AlbumCardProps = {
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  first_release_date: string;
};

export default function AlbumCard({
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
  first_release_date,
}: AlbumCardProps) {
  const albumCoverURL = (!album_cover || album_cover.length === 0) ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;
  let releaseDate = new Date(first_release_date).toLocaleString('default', { year: 'numeric' });

  const { setGradient } = useGradientHover();

  function setDominantGradient() {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const color = await fac.getColorAsync(albumCoverURL);
      setGradient(color.hex);
    };
    getColor();
  }

  return (
    <div className="w-44 h-44" onMouseEnter={setDominantGradient}>
      <Link href={`/album?id=${album_id}`}>
        <Image src={albumCoverURL} alt={`${album_name} Image`} height={256} width={256} className="rounded cursor-pointer transition-filter duration-300 hover:brightness-50 object-fill w-full h-full" />
        <p className="mt-3 font-bold text-white overflow-hidden text-ellipsis" title={album_name}>{album_name}</p>
      </Link>

      <Link href={`/artist?id=${artist_id}`}>
        <p className="text-gray-400">
          {artist_name} • {releaseDate}
        </p>
      </Link>
    </div>
  );
}