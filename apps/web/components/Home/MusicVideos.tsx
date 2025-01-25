"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSongsWithMusicVideos } from "@music/sdk";
import { MusicVideoSong } from "@music/sdk/types";
import MusicVideoCard from "../Music/Card/MusicVideoCard";
import ScrollButtons from "./ScrollButtons";

const MemoizedMusicVideoCard = memo(MusicVideoCard);

async function getMusicVideos(): Promise<MusicVideoSong[]> {
  const allMusicVideos = await getSongsWithMusicVideos();
  
  const uniqueNames = new Set();
  const uniqueMusicVideos = allMusicVideos.filter(song => {
    if (!uniqueNames.has(song.name)) {
      uniqueNames.add(song.name);
      return true;
    }
    return false;
  });

  return uniqueMusicVideos
    .sort(() => 0.5 - Math.random())
    .slice(0, 30);
}

export default function MusicVideos() {
  const { data: songs = [], isLoading } = useQuery({
    queryKey: ['musicVideos'],
    queryFn: getMusicVideos,
    staleTime: 60 * 60 * 1000,
    enabled: true
  });

  if (isLoading) return null;
  if (!songs.length) return null;

  return (
    <ScrollButtons heading="Music Videos" id="MusicVideos">
      <div className="flex flex-row">
        {songs.map((song) => (
          <MemoizedMusicVideoCard key={song.id} song={song} />
        ))}
      </div>
    </ScrollButtons>
  );
}