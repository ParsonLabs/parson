"use client"

import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getRandomSong } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import BigCard from "../Music/Card/BigCard";
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

  const session = getSession();

  return (
    <ScrollButtons heading="Random Selection">
      <div className="flex flex-row">
        {randomSongs.map((song, index) => (
          <div className="mr-20" key={index}>
            <BigCard
              title={song.name}
              album={song.album_object}
              artist={song.artist_object}
              imageSrc={
                song.album_object.cover_url.length === 0
                  ? "/snf.png"
                  : `${getBaseURL()}/image/${encodeURIComponent(song.album_object.cover_url)}`
              }
              albumURL=""
              songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${(session && session.bitrate) ?? 0}`}
              type="Song"
              song={song}
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}