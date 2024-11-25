"use client"

import setCache, { getCache } from "@/lib/Caching/cache";
import { getRandomSong } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import SongCard from "../Music/Card/SongCard";
import ScrollButtons from "./ScrollButtons";

export const revalidate = 3600;

async function getRandomSongs(genre?: string): Promise<LibrarySong[]> {
  const randomSongs = await getRandomSong(10, genre);
  return randomSongs;
}

interface RandomSongsProps {
  genre?: string;
}

export default function RandomSongs({ genre }: RandomSongsProps) {
  const [randomSongs, setRandomSongs] = useState<LibrarySong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchRandomSongs() {
      const cacheKey = "randomSongs";
      const cachedData = genre ? null : getCache(cacheKey);

      if (cachedData) {
        setRandomSongs(cachedData);
        setLoading(false);
      } else {
        const songs = await getRandomSongs(genre);
        setRandomSongs(songs);
        setLoading(false);
        if (!genre) {
          setCache(cacheKey, songs, 3600000);
        }
      }
    }

    fetchRandomSongs();
  }, [genre]);

  if (loading) return null;
  if (!randomSongs || randomSongs.length === 0) return null;

  return (
    <ScrollButtons heading="Random Selection" id="RandomSongs">
      <div className="flex flex-row pb-14">
        {randomSongs.map((song, index) => (
          <div className="mr-20" key={index}>
            <SongCard album_cover={song.album_object.cover_url} album_id={song.album_object.id} album_name={song.album_object.name} artist_id={song.artist_object.id} artist_name={song.artist} path={song.path} song_id={song.id} song_name={song.name} />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}