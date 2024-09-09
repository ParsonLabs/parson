import getBaseURL from "@/lib/Server/getBaseURL";
import { Artist } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";

type ArtistCardProps = {
  artist: Artist
}

function formatFollowers(followers: number): string {
  if (followers >= 1000000) {
    return (followers / 1000000).toFixed(1) + 'M';
  } else if (followers >= 1000) {
    return (followers / 1000).toFixed(1) + 'K';
  } else {
    return followers.toString();
  }
}

export default async function ArtistCard({ artist }: ArtistCardProps) {
  const artistIconURL = artist.icon_url.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}`

  return (
    <Link href={`/artist?id=${artist.id}`}>
      <div className="w-44 h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Image width={256} height={256} src={artistIconURL} alt={`${artist.name} Image`} className="rounded-full"/>
          <div className="flex flex-col items-center justify-center">
            <p className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={artist.name}>{artist.name}</p>
            <p className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={artist.name}>{formatFollowers(artist.followers)} Followers</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
