"use client";

import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import { Play, Pause, Volume2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePlayer } from "../Player/usePlayer";
import SongContextMenu from "../SongContextMenu";
import { getSongInfo } from "@music/sdk";
import { useSession } from "@/components/Providers/AuthProvider";
import { useState } from "react";

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
    song,
    isPlaying,
    volume,
    togglePlayPause,
  } = usePlayer();

  const playingSongID = song?.id;

  const { session } = useSession();

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
    try {
      const songInfo = await getSongInfo(song_id);
      setSong(songInfo);
      setAudioSource(songURL);
      setPlayedFromAlbum(false);
    } catch (error) {
      console.error("Failed to fetch song info:", error);
    }
  }

  const { setGradient } = useGradientHover();

  function setDominantGradient() {
    const fac = new FastAverageColor();
    const getColor = async () => {
      try {
        const color = await fac.getColorAsync(imageSrc);
        setGradient(color.hex);
      } catch (error) {
        console.error("Failed to get dominant color:", error);
      }
    };
    getColor();
  }

  const [isHovered, setIsHovered] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  return (
    <div
      className="w-44 h-60 relative flex flex-col items-center"
      onMouseEnter={() => {
        setDominantGradient();
        setIsHovered(true);
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <SongContextMenu
        song_name={song_name}
        song_id={song_id}
        artist_id={artist_id}
        artist_name={artist_name}
        album_id={album_id}
        album_name={album_name}
      >
        <div className="relative w-full h-44">
          <Image
            src={imageSrc}
            alt={song_name + " Image"}
            height={512}
            width={512}
            loading="lazy"
            className={`rounded cursor-pointer transition-filter duration-300 object-fill w-full h-full ${
              isHovered || song_id == song.id ? "brightness-50" : ""
            }`}
            onClick={handlePlay}
          />
          {playingSongID === song_id && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation();
                togglePlayPause();
              }}
            >
              {volume < 1 ? (
                isVolumeHovered ? (
                  isPlaying ? (
                    <Pause className="w-12 h-12 text-white" fill="white" strokeWidth={0} />
                  ) : (
                    <Play className="w-12 h-12 text-white" fill="white" strokeWidth={0} />
                  )
                ) : (
                  <Volume2
                    className="w-12 h-12 text-white"
                    onMouseEnter={() => setIsVolumeHovered(true)}
                    onMouseLeave={() => setIsVolumeHovered(false)}
                  />
                )
              ) : isPlaying ? (
                <Pause className="w-12 h-12 text-white" fill="white" strokeWidth={0} />
              ) : (
                <Play className="w-12 h-12 text-white" fill="white" strokeWidth={0} />
              )}
            </div>
          )}
        </div>
      </SongContextMenu>
  
      <div className="flex flex-col text-left mt-3 w-full px-2">
        <p
          className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap"
          title={song_name}
        >
          <Link href={`/album?id=${album_id}`}>{song_name}</Link>
        </p>
        <p className="text-gray-400 flex items-center whitespace-nowrap">
          Song • 
          <Link href={`/artist?id=${artist_id ?? "0"}`} className="ml-1 overflow-hidden text-ellipsis min-w-0" style={{ minWidth: '50px', maxWidth: '200px'}}>
            <span className="block truncate">
              {artist_name}
            </span>
          </Link>
        </p>
      </div>
    </div>
  );
}