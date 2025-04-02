"use client"

import { memo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAllGenres, getSongsByGenres, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import ScrollButtons from "./ScrollButtons";
import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
import { Play } from "lucide-react";

interface GenreStats {
  name: string;
  songCount: number;
  coverImage?: string;
}

const genreGradients = [
  { from: "#4F46E5", to: "#2D3A8C" }, // Indigo
  { from: "#8B5CF6", to: "#4C1D95" }, // Purple
  { from: "#EC4899", to: "#831843" }, // Pink
  { from: "#F43F5E", to: "#881337" }, // Rose
  { from: "#10B981", to: "#065F46" }, // Emerald
  { from: "#6366F1", to: "#3730A3" }, // Violet
  { from: "#0EA5E9", to: "#075985" }, // Sky
  { from: "#F59E0B", to: "#92400E" }, // Amber
  { from: "#8B5CF6", to: "#4338CA" }, // Indigo/Purple
  { from: "#3B82F6", to: "#1E40AF" }, // Blue
];

function formatGenreName(genre: string): string {
  const specialCases: Record<string, string> = {
    'r&b': 'R&B',
    'hip hop': 'Hip Hop',
    'hip-hop': 'Hip-Hop',
    'drum & bass': 'Drum & Bass',
    'drum and bass': 'Drum & Bass',
    'k-pop': 'K-Pop',
    'j-pop': 'J-Pop',
  };
  
  const lowercased = genre.toLowerCase();
  if (specialCases[lowercased]) return specialCases[lowercased];
  
  return genre.replace(/\b\w/g, char => char.toUpperCase());
}

async function getPopularGenres(): Promise<GenreStats[]> {
  try {
    const allGenres = await listAllGenres();
    
    const genrePromises = allGenres.map(async (genre) => {
      let songs = await getSongsByGenres([genre]);

      return {
        name: genre,
        songCount: songs.length,
        coverImage: "" 
      };
    });
    
    const genreStats = await Promise.all(genrePromises);
    
    return genreStats
      .sort((a, b) => b.songCount - a.songCount)
      .slice(0, 10);
  } catch (err) {
    console.error("Error fetching popular genres:", err);
    return [];
  }
}

export default function PopularGenres() {
  const { data: genres = [], isLoading } = useQuery({
    queryKey: ['popularGenres'],
    queryFn: getPopularGenres,
    staleTime: 24 * 60 * 60 * 1000,
  });

  if (isLoading) return (
    <ScrollButtons heading="Popular Genres" id="PopularGenres">
      <div className="flex flex-row pb-14 animate-pulse">
        {[...Array(5)].map((_, i) => (
          <div 
            className="mr-4 w-[200px] h-[200px] bg-gray-800 rounded-xl shadow-lg" 
            key={i}
          ></div>
        ))}
      </div>
    </ScrollButtons>
  );

  if (!genres || genres.length === 0) return null;

  return (
    <ScrollButtons heading="Popular Genres" id="PopularGenres">
      <div className="flex flex-row pb-14">
        {genres.map((genre, index) => {
          const gradientIndex = index % genreGradients.length;
          const gradient = genreGradients[gradientIndex];
          
          return (
            <motion.div 
              key={genre.name}
              whileHover={{ y: -8, scale: 1.02 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
              className="mr-5"
            >
              <Link 
                href={`/genre/${encodeURIComponent(genre.name)}`}
                className="block w-[200px] h-[200px] relative rounded-xl overflow-hidden shadow-lg group"
              >
                {genre.coverImage ? (
                  <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-110">
                    <Image 
                      src={genre.coverImage}
                      alt={genre.name}
                      fill
                      className="object-cover"
                      sizes="200px"
                    />
                  </div>
                ) : (
                  <div 
                    className="absolute inset-0 transition-transform duration-700 group-hover:scale-110"
                    style={{
                      background: `linear-gradient(135deg, ${gradient?.from}, ${gradient?.to})`
                    }}
                  />
                )}

                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/80 z-10"></div>
                
                <div className="absolute inset-0 z-20 flex flex-col justify-between p-5">
                  <div className="flex justify-between items-start">
                    <span className="px-3 py-1 bg-black/40 backdrop-blur-md rounded-full text-xs font-medium text-white">
                      {genre.songCount} tracks
                    </span>
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.5 }}
                      whileHover={{ opacity: 1, scale: 1 }}
                      className="bg-white/90 rounded-full p-2 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Play className="w-4 h-4 text-black fill-black" />
                    </motion.div>
                  </div>
                  
                  <div>
                    <h3 className="text-2xl font-bold text-white mb-1 drop-shadow-md">
                      {formatGenreName(genre.name)}
                    </h3>
                    <div className="h-1 w-12 bg-white/70 rounded-full transition-all duration-300 group-hover:w-24 group-hover:bg-white"></div>
                  </div>
                </div>

                <div className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity duration-300 z-10"></div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </ScrollButtons>
  );
}