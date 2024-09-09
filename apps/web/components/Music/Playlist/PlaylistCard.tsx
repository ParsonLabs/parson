import getBaseURL from "@/lib/Server/getBaseURL";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";

type PlaylistCardProps = {
  song: LibrarySong,
  coverURL: string
  artist: Artist
  album: Album
}

export default function PlaylistCard({ song, coverURL, artist, album }: PlaylistCardProps) {
  return (
    <div className="flex items-center">
      <Image src={`${getBaseURL()}/image/${encodeURIComponent(coverURL)}`} alt={song.name + " Image"} width={64} height={64} className="rounded" />
      <div className="flex flex-col ml-4">
        <Link onClick={(e) => e.stopPropagation()} href={`/album?id=${album.id}`}><p>{song.name}</p></Link>
        <Link onClick={(e) => e.stopPropagation()} href={`/artist?id=${artist.id}`}><p>{song.artist}</p></Link>
      </div>
    </div>
  )
}
