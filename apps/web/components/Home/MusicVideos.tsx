import { getSongsWithMusicVideos } from "@music/sdk";
import { useEffect, useState } from "react";
import MusicVideoCard from "../Music/Card/MusicVideoCard";
import ScrollButtons from "./ScrollButtons";
import { MusicVideoSong } from "@music/sdk/types";
import setCache, { getCache } from "@/lib/Caching/cache";

export default function MusicVideos() {
  const [songs, setSongs] = useState<MusicVideoSong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAllMusicVideos() {
      const cacheKey = "musicVideos";
      const cachedData = getCache(cacheKey);

      if (cachedData) {
        setSongs(cachedData);
        setLoading(false);
      } else {
        const allMusicVideos = await getSongsWithMusicVideos();
        
        const uniqueNames = new Set();
        const uniqueMusicVideos = [];
        
        for (const song of allMusicVideos) {
          if (!uniqueNames.has(song.name)) {
            uniqueNames.add(song.name);
            uniqueMusicVideos.push(song);
          }
        }

        const randomizedMusicVideos = uniqueMusicVideos.sort(() => 0.5 - Math.random());

        const musicVideos = randomizedMusicVideos.slice(0, 30);
        
        setSongs(musicVideos);
        setLoading(false);
        setCache(cacheKey, musicVideos, 3600000);
      }
    }
  
    fetchAllMusicVideos();
  }, []);

  if (loading) return null;

  return songs && (
    <ScrollButtons heading="Music Videos" id="MusicVideos">
      <div className="flex flex-row">
        {songs.map((song) => (
          <MusicVideoCard key={song.id} song={song} />
        ))}
      </div>
    </ScrollButtons>
  );
}