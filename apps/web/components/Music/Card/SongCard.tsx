"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getSession from "@/lib/Authentication/JWT/getSession";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import Link from "next/link";
import { usePlayer } from "../Player/usePlayer";
import SongContextMenu from "../SongContextMenu";
import { getSongInfo } from "@music/sdk";

type SongCardProps = {
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  path: string;
};

export default function SongCard({
  song_name,
  song_id,
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
  path,
}: SongCardProps) {
  const {
    setImageSrc,
    setAudioSource,
    setSong,
    setArtist,
    setAlbum,
    setPlayedFromAlbum,
  } = usePlayer();

  const session = getSession();

  const artist = { id: artist_id, name: artist_name };
  const album = { id: album_id, name: album_name, cover_url: album_cover };

  let imageSrc =
    album_cover?.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(album_cover)}`;


  let songURL = `${getBaseURL()}/api/stream/${encodeURIComponent(
    path
  )}?bitrate=${(session && session.bitrate) || 0}`;

  async function handlePlay() {
    setImageSrc(imageSrc);
    setArtist(artist);
    setAlbum(album);
    const songInfo = await getSongInfo(song_id)
    setSong(songInfo);
    setAudioSource(songURL);
    setPlayedFromAlbum(false);
  }

  const { setGradient } = useGradientHover();

  function setDominantGradient() {
    const fac = new FastAverageColor();
    const getColor = async () => {
      const color = await fac.getColorAsync(imageSrc);
      setGradient(color.hex);
    };
    getColor();
  }

  return (
    <div className="w-44 h-44" onMouseEnter={setDominantGradient}>
      <SongContextMenu song_name={song_name} song_id={song_id} artist_id={artist_id} artist_name={artist_name} album_id={album_id} album_name={album_name}>
        <Image
          src={imageSrc}
          alt={song_name + " Image"}
          height={512}
          width={512}
          loading="lazy"
          className="rounded cursor-pointer transition-filter duration-300 hover:brightness-50 object-fill w-full h-full"
          onClick={handlePlay}
        />
      </SongContextMenu>

      <div className="flex flex-col text-left mt-3">
        <p
          className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap"
          title={song_name}
        >
          <Link href={`/album?id=${album_id}`}>{song_name}</Link>
        </p>
        <p className="text-gray-400">
          Song • <Link href={`/artist?id=${artist_id ?? "0"}`}>{artist_name}</Link>
        </p>
      </div>
    </div>
  );
}