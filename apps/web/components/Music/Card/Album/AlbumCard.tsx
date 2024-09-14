import getBaseURL from "@/lib/Server/getBaseURL";
import { Album, Artist } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";

type AlbumCardProps = {
  artist: Artist
  album: Album
}

export default function AlbumCard({ artist, album }: AlbumCardProps) {
  const albumCoverURL = (!album.cover_url || album.cover_url.length === 0) ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)} `
  let releaseDate = new Date(album.first_release_date).toLocaleString('default', { year: 'numeric' });

  return (
    <div className="w-44 h-44">
      <Link href={`/album?id=${album.id}`}>
        <Image src={albumCoverURL} alt={album.name + " Image"} height={256} width={256} className="rounded cursor-pointer transition-filter duration-300 hover:brightness-50 object-fill w-full h-full" />
        <p className="mt-3 font-bold text-white overflow-hidden text-ellipsis" title={album.name}>{album.name}</p>
      </Link>

      <Link href={`/artist?id=${artist.id}`}>
        <p className="text-gray-400">
          {artist.name} • {releaseDate}
        </p>
      </Link>

    </div>
  )
}
