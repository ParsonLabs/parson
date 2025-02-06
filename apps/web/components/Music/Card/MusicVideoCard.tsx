"use client";

import { getSongInfo } from "@music/sdk";
import { LibrarySong, MusicVideoSong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@music/ui/components/dialog";
import { Video } from "lucide-react";
import ReactPlayer from 'react-player/youtube';
import { usePlayer } from "../Player/usePlayer";

type MusicVideoCardProps = {
  song: MusicVideoSong
};

export default function MusicVideoCard({ song }: MusicVideoCardProps) {
  const [songInfo, setSongInfo] = useState<LibrarySong>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    async function fetchSongInfo() {
      const fetchedSongInfo = await getSongInfo(song.id, false) as LibrarySong;
      setSongInfo(fetchedSongInfo);
    }

    fetchSongInfo();
  }, [song.id]);

  if (!song || !song.music_video) return null;

  const getVideoId = (url: string) => {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com') {
        return urlObj.searchParams.get('v');
      } else if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.slice(1);
      }
    } catch (error) {
      console.error('Invalid URL:', url);
      return null;
    }
  };

  const videoId = getVideoId(song.music_video.url);
  const thumbnailUrl = videoId ? `http://i3.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";

  return (
    <div className="w-96 pr-6 shadow-lg flex flex-col rounded-md overflow-y-hidden">
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="flex-grow cursor-pointer"
          >
            <Image
              src={thumbnailUrl}
              width={500}
              height={700}
              alt="YouTube Thumbnail"
              className="rounded transition-filter duration-300 hover:brightness-50 object-cover w-80 h-44"
              loading="lazy"
            />
          </div>
        </DialogTrigger>
        <DialogContent className="max-w-[1000px] h-[80vh] bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle>{song.name} Music Video</DialogTitle>
          </DialogHeader>
          <div className="flex items-center space-x-2 h-full rounded-sm">
            <ReactPlayer 
              controls
              width="100%"
              height="70vh"
              pip={true}
              playing={isDialogOpen}
              url={song.music_video.url}
            />
          </div>
          <DialogFooter className="sm:justify-start">
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col text-left mt-3 flex-grow overflow-hidden">
        <p className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={song.name}>
          <Link href={`/album?id=${songInfo?.album_object.id || 0}`}>{song.name}</Link>
        </p>
        <p className="text-gray-400 overflow-hidden overflow-ellipsis whitespace-nowrap">
          <Link href={`/album?id=${songInfo?.album_object.id || 0}`}>{songInfo?.album_object.name ?? ""}</Link> • <Link href={`/artist?id=${songInfo?.artist_object.id ?? "0"}`}>{songInfo?.artist_object.name}</Link>
        </p>
      </div>
    </div>
  );
}