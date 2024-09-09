import { Album, LibrarySong } from "@music/sdk/types";
import Link from "next/link";

type PlaylistCardProps = {
  song: LibrarySong,
  album: Album 
}

export default function AlbumCard({ song, album }: PlaylistCardProps) {
  return (
    <div className="flex items-center">
      <div className="flex flex-col ml-4">
        <Link onClick={(e) => e.stopPropagation()} href={`/album?id=${album.id}`}><p>{song.name}</p></Link>
      </div>
    </div>
  )
}
