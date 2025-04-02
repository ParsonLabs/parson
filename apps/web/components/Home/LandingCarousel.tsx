"use client";

import React, { memo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getRandomAlbum } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import { Skeleton } from "@music/ui/components/skeleton";
import { Play, ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FastAverageColor } from 'fast-average-color';
import { motion, AnimatePresence } from "framer-motion";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import ScrollButtons from "./ScrollButtons";

async function getRandomAlbumsAndSongs(count = 5): Promise<Array<{ album: Album & { artist_object: Artist }, songs: LibrarySong[] }>> {
  const randomAlbums = await getRandomAlbum(20);
  
  const uniqueAlbums = Array.from(
    new Map(randomAlbums.map(album => [album.id, album])).values()
  );
  
  const eligibleAlbums = uniqueAlbums
    .filter(album => album && album.cover_url)
    .filter(album => album.songs && album.songs.length >= 3)
    .slice(0, count);
  
  return eligibleAlbums.map(album => {
    const sampleSize = Math.min(3, album.songs.length);
    const songs = shuffleSongs(album.songs).slice(0, sampleSize);
    return { album, songs };
  });
}

function shuffleSongs(array: any[]) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function sanitizeSongName(songName: string) {
  return songName.replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
}

const LandingCarouselSkeleton: React.FC = () => {
  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ height: '380px' }}>
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 to-zinc-800 animate-pulse" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex flex-col md:flex-row items-center gap-8 p-8 w-full max-w-6xl">
          <Skeleton className="rounded-xl h-64 w-64 flex-shrink-0" />
          <div className="space-y-4 flex-1">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-10 w-32 mt-8" />
          </div>
          <div className="hidden lg:block space-y-3 flex-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-full max-w-xs" />
            <Skeleton className="h-4 w-full max-w-xs" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </div>
        </div>
      </div>
    </div>
  );
};

const CarouselSlide = memo(({ item, currentColor, index, activeIndex }: { 
  item: { album: Album & { artist_object: Artist }, songs: LibrarySong[] };
  currentColor: string;
  index: number;
  activeIndex: number;
}) => {
  const albumCoverURL = `${getBaseURL()}/image/${encodeURIComponent(item.album.cover_url)}?raw=true`;
  const isActive = index === activeIndex;
  
  return (
    <motion.div 
      className={`absolute inset-0 rounded-2xl overflow-hidden ${isActive ? 'z-10' : 'z-0'}`}
      initial={{ opacity: 0, x: index > activeIndex ? 100 : -100 }}
      animate={{ 
        opacity: isActive ? 1 : 0, 
        x: isActive ? 0 : (index > activeIndex ? 100 : -100),
        scale: isActive ? 1 : 0.95
      }}
      transition={{ duration: 0.5, ease: "easeInOut" }}
    >
      <div className="absolute inset-0">
        <Image
          src={albumCoverURL}
          alt={`${item.album.name} background`}
          fill
          priority={isActive}
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/60 to-black/80" />
      </div>
      
      <div className="relative z-10 h-full flex flex-col md:flex-row items-center justify-center px-6 md:px-12 py-10 max-w-7xl mx-auto">
        <motion.div 
          className="flex-shrink-0 mb-6 md:mb-0"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <Image
            src={albumCoverURL}
            alt={item.album.name}
            width={250}
            height={250}
            className="rounded-lg shadow-2xl"
            style={{ objectFit: "cover" }}
            priority={isActive}
          />
        </motion.div>
        
        <motion.div 
          className="flex-1 text-center md:text-left md:ml-10 lg:ml-16"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <Link href={`/album?id=${item.album.id}`}>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-white mb-2 md:mb-3">
              {item.album.name}
            </h2>
          </Link>
          
          <Link href={`/artist?id=${item.album.artist_object.id}`}>
            <p className="text-lg md:text-xl text-gray-300 mb-6 md:mb-8">
              {item.album.artist_object.name}
            </p>
          </Link>
          
          <div className="flex flex-col md:flex-row gap-4 md:items-center">
            <Link href={`/album?id=${item.album.id}`}>
              <Button 
                className="rounded-full px-6 py-6 text-white font-medium transition-all shadow-xl hover:shadow-lg hover:brightness-110"
                style={{ backgroundColor: currentColor || '#6b46c1' }}
              >
                <Play className="mr-2 h-5 w-5" fill="white" strokeWidth={0} />
                Play Album
              </Button>
            </Link>
            
            <div className="hidden lg:block ml-0 md:ml-8 mt-6 md:mt-0">
              <p className="font-medium text-gray-300 text-sm mb-2">FEATURING</p>
              <ul className="space-y-1.5">
                {item.songs?.map((song, idx) => (
                  <li key={`${song.id}-${idx}`} className="flex items-center">
                    <span className="text-gray-400 mr-2 text-sm">{idx + 1}.</span>
                    <Link 
                      href={`/album?id=${item.album.id}#${sanitizeSongName(song.name)}`}
                      className="text-gray-100 hover:text-white hover:underline transition-colors text-sm md:text-base"
                    >
                      {song.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
});

CarouselSlide.displayName = 'CarouselSlide';

const LandingCarousel: React.FC = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [colors, setColors] = useState<string[]>([]);
  const { setGradientWithTransition } = useGradientHover();
  
  const { data, isLoading } = useQuery({
    queryKey: ['landingCarousel'],
    queryFn: () => getRandomAlbumsAndSongs(5),
    staleTime: 24 * 60 * 60 * 1000,
  });
  
  useEffect(() => {
    if (!data) return;
    
    const extractColors = async () => {
      const fac = new FastAverageColor();
      const extractedColors = await Promise.all(
        data.map(async (item) => {
          try {
            const coverUrl = `${getBaseURL()}/image/${encodeURIComponent(item.album.cover_url)}?raw=true`;
            const color = await fac.getColorAsync(coverUrl);
            return color.hex;
          } catch {
            return '#6b46c1';
          }
        })
      );
      setColors(extractedColors);
      
      if (extractedColors[0]) {
        setGradientWithTransition(extractedColors[0]);
      }
    };
    
    extractColors();
  }, [data, setGradientWithTransition]);
  
  const goToNext = () => {
    if (!data) return;
    const newIndex = (currentIndex + 1) % data.length;
    setCurrentIndex(newIndex);
    if (colors[newIndex]) {
      setGradientWithTransition(colors[newIndex]);
    }
  };
  
  const goToPrevious = () => {
    if (!data) return;
    const newIndex = (currentIndex - 1 + data.length) % data.length;
    setCurrentIndex(newIndex);
    if (colors[newIndex]) {
      setGradientWithTransition(colors[newIndex]);
    }
  };
  
  useEffect(() => {
    const interval = setInterval(goToNext, 10000);
    return () => clearInterval(interval);
  }, [currentIndex, data]); 
  
  if (isLoading || !data) return <LandingCarouselSkeleton />;
  
  return (
    <ScrollButtons id="LandingCarousel" heading="Featured Albums" topText="Now Trending">
      <div className="relative rounded-2xl overflow-hidden h-[380px] mt-2 group">
        <AnimatePresence mode="wait">
          {data.map((item, index) => (
            <CarouselSlide 
              key={item.album.id} 
              item={item} 
              currentColor={colors[currentIndex] || '#6b46c1'} 
              index={index}
              activeIndex={currentIndex}
            />
          ))}
        </AnimatePresence>
        
        <button
          onClick={goToPrevious}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-20 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Previous slide"
        >
          <ChevronLeft size={24} />
        </button>
        
        <button
          onClick={goToNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-20 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Next slide"
        >
          <ChevronRight size={24} />
        </button>
        
        <div className="absolute bottom-4 left-0 right-0 z-20 flex justify-center gap-2">
          {data.map((_, index) => (
            <button
              key={index}
              onClick={() => {
                setCurrentIndex(index);
                if (colors[index]) {
                  setGradientWithTransition(colors[index]);
                }
              }}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentIndex 
                  ? 'w-6 bg-white' 
                  : 'bg-white/50 hover:bg-white/80'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </ScrollButtons>
  );
};

export default LandingCarousel;