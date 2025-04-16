"use client";

import { memo, useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import getBaseURL from "@/lib/Server/getBaseURL";
import { AlbumCardProps, getSimilarTo } from "@music/sdk";
import PageGradient from "../Layout/PageGradient";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import { useSession } from "../Providers/AuthProvider";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ArrowRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const MemoizedAlbumCard = memo(AlbumCard);

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

export default function SimilarTo() {
  const { session } = useSession();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['similarTo', session?.sub],
    queryFn: () => getSimilarTo(Number(session?.sub)),
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.sub
  });

  const [similarAlbums, genre] = data || [[], null];

  useEffect(() => {
    const checkScroll = () => {
      if (!scrollContainerRef.current) return;
      
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftScroll(scrollLeft > 20);
      setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 20);
    };

    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      checkScroll();
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, [similarAlbums]);

  if (!similarAlbums?.length) return null;

  const albumCoverSrc = !similarAlbums[0]?.album_cover || similarAlbums[0].album_cover.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(similarAlbums[0].album_cover)}`;

  const handleScrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -600, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 600, behavior: 'smooth' });
    }
  };

  return (
    <motion.div 
      className="relative pb-8 mt-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <PageGradient imageSrc={albumCoverSrc} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/40 to-black/80"></div>
      
      <div className="relative flex items-end justify-between mb-6 px-6 z-10">
        <div>
          <motion.div 
            className="text-xs font-semibold tracking-wider text-gray-300 mb-2 flex items-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="mr-2 bg-white/10 px-2 py-1 rounded-full backdrop-blur-sm">SIMILAR TO</span>
            {albumCoverSrc && (
              <div className="w-6 h-6 rounded-full overflow-hidden border border-white/20 shadow-lg shadow-black/50">
                <Image src={albumCoverSrc} alt="" className="w-full h-full object-cover" height={100} width={100} />
              </div>
            )}
          </motion.div>
          
          <motion.h2 
            className="text-2xl md:text-3xl font-bold text-white flex items-center"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <span className="relative">
              {capitalizeWords(genre ?? "")}
              <span className="absolute -bottom-1 left-0 w-full h-[2px] bg-gradient-to-r from-purple-500 to-blue-500"></span>
            </span>
            <ChevronRight className="h-6 w-6 ml-1 text-gray-400" />
          </motion.h2>
        </div>
        
        {similarAlbums.length > 5 && (
          <Link href={`/genre/${encodeURIComponent(genre ?? "")}`} passHref>
            <motion.button 
              className="group flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white transition-all duration-300 backdrop-blur-sm"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.98 }}
            >
              <span>See All</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </motion.button>
          </Link>
        )}
      </div>
      
      <div className="relative z-10">
        <AnimatePresence>
          {(showLeftScroll && isHovered) && (
            <motion.button
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
              onClick={handleScrollLeft}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <ArrowLeft size={20} />
            </motion.button>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(showRightScroll && isHovered) && (
            <motion.button
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
              onClick={handleScrollRight}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              <ArrowRight size={20} />
            </motion.button>
          )}
        </AnimatePresence>

        <div 
          ref={scrollContainerRef}
          className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-6 px-6"
          style={{ scrollbarWidth: 'none' }}
        >
          {isLoading ? (
            Array(5).fill(0).map((_, index) => (
              <div 
                key={`skeleton-${index}`}
                className="snap-start shrink-0 pr-5 w-[180px]"
              >
                <div className="w-full aspect-square rounded-lg bg-white/5 animate-pulse"></div>
                <div className="h-4 bg-white/5 rounded mt-2 w-3/4 animate-pulse"></div>
                <div className="h-3 bg-white/5 rounded mt-2 w-1/2 animate-pulse"></div>
              </div>
            ))
          ) : (
            similarAlbums.map((album, index) => (
              <Link href={`/album?id=${album.album_id}`} key={album.album_id}>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ 
                  duration: 0.4, 
                  delay: index * 0.06,
                  ease: [0.23, 1, 0.32, 1]
                }}
                whileHover={{ 
                  y: -12,
                  transition: { duration: 0.2 }
                }}
                className="snap-start shrink-0 pl-8 w-[300px] group relative z-10"
                key={`${album.album_id}-${index}`}
              >
                <div className="relative overflow-hidden rounded-xl shadow-xl shadow-black/40 transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-purple-900/20">
                  <MemoizedAlbumCard
                    artist_id={album.artist_id}
                    artist_name={album.artist_name}
                    album_id={album.album_id}
                    album_name={album.album_name}
                    album_cover={album.album_cover}
                    album_songs_count={album.album_songs_count}
                    first_release_date={album.first_release_date}
                  />
                  <motion.div 
                    className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                  />
                </div>
              </motion.div>
              </Link>
            ))
          )}
        </div>
        
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-black to-transparent pointer-events-none z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-black to-transparent pointer-events-none z-10" />
      </div>
    </motion.div>
  );
}