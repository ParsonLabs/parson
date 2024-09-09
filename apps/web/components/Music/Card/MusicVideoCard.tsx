"use client";

import { getSongInfo } from "@music/sdk";
import { LibrarySong, MusicVideoSong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type MusicVideoCardProps = {
  song: MusicVideoSong
};

export default function MusicVideoCard({ song }: MusicVideoCardProps) {
  const [songInfo, setSongInfo] = useState<LibrarySong>()
  useEffect(() => {
    async function fetchSongInfo() {
      const fetchedSongInfo = await getSongInfo(song.id)
      setSongInfo(fetchedSongInfo)
    }

    fetchSongInfo()
  }, [song.id])

  if (!song || !song.music_video) return null

  const getVideoId = (url: string) => {
    const urlParams = new URLSearchParams(new URL(url).search);
    return urlParams.get("v");
  };

  const videoId = getVideoId(song.music_video.url);
  const thumbnailUrl = videoId ? `http://i3.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";

  return (
    <div className="w-96 pr-6 shadow-lg flex flex-col rounded-md overflow-y-hidden" onMouseEnter={() => {}}>
      <Link href={song.music_video.url} target="_blank" rel="noopener noreferrer" className="flex-grow">
        <Image
          src={thumbnailUrl}
          width={500}
          height={700}
          alt="YouTube Thumbnail"
          className="rounded cursor-pointer transition-filter duration-300 hover:brightness-50 object-cover w-80 h-44"
          loading="lazy"
        />
      </Link>
          
      <div className="flex flex-col text-left mt-3 flex-grow overflow-hidden">
        <p className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={song.name}>
          <Link href={`/album?id=${songInfo?.album_object.id}`}>{song.name}</Link>
        </p>
        <p className="text-gray-400 overflow-hidden overflow-ellipsis whitespace-nowrap">
          <Link href={`/album?id=${songInfo?.album_object.id}`}>{songInfo?.album_object.name}</Link> • <Link href={`/artist?id=${songInfo?.artist_object.id ?? "0"}`}>{songInfo?.artist_object.name}</Link>
        </p>
      </div>
    </div>
  );
}