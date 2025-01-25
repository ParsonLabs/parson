"use client";

import { getSongInfo } from "@music/sdk";
import { LibrarySong, MusicVideoSong } from "@music/sdk/types";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@music/ui/components/dialog";
import ReactPlayer from 'react-player/youtube';

type ArtistMusicVideoCardProps = {
  song: MusicVideoSong
};

export default function ArtistMusicVideoCard({ song }: ArtistMusicVideoCardProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  if (!song.music_video) return null;

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
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <div 
          className="w-[300px] flex-none group cursor-pointer"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="relative aspect-video mb-3">
            <Image
              src={thumbnailUrl}
              alt={`${song.name} thumbnail`}
              layout="fill"
              className="rounded-lg object-cover transition-all duration-300 group-hover:brightness-75"
            />
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
              <Play className="w-12 h-12 text-white" fill="white" strokeWidth={0} />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="font-medium text-white truncate">{song.name}</h3>
            <p className="text-sm text-gray-400 truncate">{song.artist}</p>
          </div>
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-5xl h-[80vh] bg-neutral-900/95 backdrop-blur-xl border-neutral-800">
        <DialogHeader>
          <DialogTitle className="text-white">{song.name}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-center h-full rounded-lg overflow-hidden">
          <ReactPlayer 
            url={song.music_video.url}
            width="100%"
            height="100%"
            controls
            playing={isDialogOpen}
            pip
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}