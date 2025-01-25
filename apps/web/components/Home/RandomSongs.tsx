"use client"

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRandomSong } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import SongCard from "../Music/Card/SongCard";
import ScrollButtons from "./ScrollButtons";

const MemoizedSongCard = memo(SongCard);

async function getRandomSongs(genre?: string): Promise<LibrarySong[]> {
  return await getRandomSong(10, genre);
}

interface RandomSongsProps {
  genre?: string;
}

export default function RandomSongs({ genre }: RandomSongsProps) {
  const { data: randomSongs = [], isLoading } = useQuery({
    queryKey: ['randomSongs', genre],
    queryFn: () => getRandomSongs(genre),
    staleTime: 60 * 60 * 1000,
    enabled: true
  });

  if (isLoading) return null;
  if (!randomSongs || randomSongs.length === 0) return null;

  return (
    <ScrollButtons heading="Random Selection" id="RandomSongs">
      <div className="flex flex-row pb-14">
        {randomSongs.map((song) => (
          <div className="mr-20" key={`${song.id}-${song.album_object.id}`}>
            <MemoizedSongCard 
              album_cover={song.album_object.cover_url} 
              album_id={song.album_object.id} 
              album_name={song.album_object.name} 
              artist_id={song.artist_object.id} 
              artist_name={song.artist} 
              path={song.path} 
              song_id={song.id} 
              song_name={song.name} 
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}