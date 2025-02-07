"use client"

import getBaseURL from "@/lib/Server/getBaseURL";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getSession from "@/lib/Authentication/JWT/getSession";
import formatDuration from "@/lib/Formatting/formatDuration";
import formatFollowers from "@/lib/Formatting/formatFollowers";
import formatReleaseDate from "@/lib/Formatting/formatReleaseDate";
import { getSongInfo } from "@music/sdk";
import { AlbumInfo, ArtistInfo, CombinedItem, LibrarySong } from "@music/sdk/types";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import Link from "next/link";
import { usePlayer } from "../Player/usePlayer";
import { useSession } from "@/components/Providers/AuthProvider";

type HorizontalCardProps = {
  item: CombinedItem
};

export default function HorizontalCard({ item }: HorizontalCardProps) {
  const { item_type, name, artist_object, album_object, song_object } = item;
  const imagePath = album_object?.cover_url || artist_object?.icon_url || "";
  const { session } = useSession()

  const {
    setImageSrc,
    setAudioSource,
    setSong,
    setArtist,
    setAlbum,
    setPlayedFromAlbum
  } = usePlayer();
  
  const { setGradient } = useGradientHover();
  
  function setDominantGradient() {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const color = await fac.getColorAsync(imageUrl ?? "");
      setGradient(color.hex);
    };
    getColor();
  }
  
  async function handlePlay() {
    setImageSrc(imageUrl);

    const song = await getSongInfo(item.id ?? "", false) as LibrarySong

    setArtist(song.artist_object);
    setAlbum(song.album_object);
    setSong(song);
    session && setAudioSource(`${getBaseURL()}/api/stream/${encodeURIComponent(song?.path ?? "")}?bitrate=${session.bitrate ?? 0}`);
    setPlayedFromAlbum(false)
  }
    
  const imageUrl = imagePath ? `${getBaseURL()}/image/${encodeURIComponent(imagePath)}` : '/snf.png';

  return (
    <ConditionalLink type={item_type} album={album_object} artist={artist_object}>
      <div 
        className="group w-full text-white flex items-center p-2 rounded-lg hover:bg-white/10 transition-all duration-200 backdrop-blur-sm cursor-pointer"
        onMouseEnter={setDominantGradient} 
        onClick={() => item_type == "song" && handlePlay()}
      >
        <div className="relative flex-shrink-0">
          <Image 
            src={imageUrl} 
            className={`${item.item_type === "artist" ? "rounded-full" : "rounded-lg"} object-cover transition-all duration-300 group-hover:brightness-75`} 
            width={64} 
            height={64} 
            alt={`${name} Image`} 
          />
        </div>

        <div className="ml-4 min-w-0">
          <p className="font-medium text-white truncate">{name}</p>
          <div className="text-sm text-gray-400">
            {item_type == "song" && song_object && (
              <div className="flex items-center gap-2">
                <Link href={`/artist?id=${artist_object?.id ?? "0"}`} className="hover:underline truncate">
                  {artist_object?.name}
                </Link>
                <span>•</span>
                <Link href={`/album?id=${album_object?.id ?? "0"}`} className="hover:underline truncate">
                  {album_object?.name}
                </Link>
                <span>•</span>
                <span>{formatDuration(song_object.duration)}</span>
              </div>
            )}
            {item_type == "album" && album_object && (
              <div className="flex items-center gap-2">
                <span>Album</span>
                <span>•</span>
                <Link href={`/artist?id=${artist_object?.id ?? "0"}`} className="hover:underline truncate">
                  {artist_object?.name}
                </Link>
                <span>•</span>
                <span>{formatReleaseDate(album_object?.first_release_date ?? "")}</span>
              </div>
            )}
            {item_type == "artist" && artist_object && (
              <div className="flex items-center gap-2">
                <span>Artist</span>
                <span>•</span>
                <span>{formatFollowers(artist_object?.followers ?? 0)} Followers</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </ConditionalLink>
  )
}

function ConditionalLink({ children, artist, album, type }: { children: React.ReactNode, artist?: ArtistInfo, album?: AlbumInfo, type: string }) {
  if (type === "song") {
    return <>{children}</>;
  }

  const href = type === "artist" && artist ? `/artist?id=${artist.id}` : type === "album" && album ? `/album?id=${album.id}` : '/';
  return (
    <Link href={href}>
      {children}
    </Link>
  );
}
