import getBaseURL from "@/lib/Server/getBaseURL";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";

type PlaylistCardProps = {
  song: LibrarySong,
  coverURL: string,
  artist: Artist,
  album: Album,
  showCover?: boolean,
  showArtist?: boolean
}

export default function PlaylistCard({ song, coverURL, artist, album, showCover = true, showArtist = true }: PlaylistCardProps) {
  return (
    <div className="flex items-center">
      {showCover && (
        <Image
          src={`${getBaseURL()}/image/${encodeURIComponent(coverURL)}`}
          alt={song.name + " Image"}
          width={64}
          height={64}
          className="rounded"
        />
      )}
      <div className="flex flex-col">
        <Link onClick={(e) => e.stopPropagation()} href={`/album?id=${album.id}`}>
          <p>{song.name}</p>
        </Link>
        {showArtist && (
          <Link onClick={(e) => e.stopPropagation()} href={`/artist?id=${artist.id}`}>
            <p>{artist.name}</p>
          </Link>
        )}
      </div>
    </div>
  )
}