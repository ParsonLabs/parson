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
    <div className="flex items-center gap-4">
      {showCover && (
        <div className="relative w-12 h-12 flex-shrink-0">
          <Image
            src={`${getBaseURL()}/image/${encodeURIComponent(coverURL)}`}
            alt={song.name + " Image"}
            width={48}
            height={48}
            className="rounded-md object-cover shadow-md transition-transform duration-200 group-hover:shadow-lg"
          />
        </div>
      )}
      
      <div className="flex flex-col min-w-0 gap-0.5">
        <Link 
          onClick={(e) => e.stopPropagation()} 
          href={`/album?id=${album.id}`}
          className="text-white hover:underline truncate font-medium"
        >
          <span className="truncate">{song.name}</span>
        </Link>
        
        {showArtist && (
          <Link 
            onClick={(e) => e.stopPropagation()} 
            href={`/artist?id=${artist.id}`}
            className="text-neutral-400 text-sm hover:text-white transition-colors truncate"
          >
            <span className="truncate">{artist.name}</span>
          </Link>
        )}
      </div>
    </div>
  )
}