"use client";

import { useState, useEffect, memo } from "react";
import { getSongsWithMusicVideos } from "@music/sdk";
import { MusicVideoSong } from "@music/sdk/types";
import { motion } from "framer-motion";
import YouTubeMusicVideoCard from "./Card/YouTubeMusicVideoCard";

const MemoizedYouTubeMusicVideoCard = memo(YouTubeMusicVideoCard);

export default function MusicVideosHomepage() {
  const [musicVideos, setMusicVideos] = useState<MusicVideoSong[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchMusicVideos = async () => {
      try {
        const videos = await getSongsWithMusicVideos();
        const shuffledVideos = [...videos].sort(() => Math.random() - 0.5);
        setMusicVideos(shuffledVideos.slice(0, 12));
      } catch (error) {
        console.error("Failed to fetch music videos:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMusicVideos();
  }, []);

  return (
    <motion.div 
      className="min-h-screen py-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array(12).fill(0).map((_, index) => (
              <div key={index} className="bg-zinc-800/30 rounded-xl animate-pulse h-64"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
            {musicVideos.map((video) => (
              <div key={video.id} className="h-full flex">
                <MemoizedYouTubeMusicVideoCard song={video} />
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}