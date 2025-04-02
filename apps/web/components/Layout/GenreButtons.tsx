"use client";

import { useState, memo, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings } from "lucide-react";
import { Button } from "@music/ui/components/button";
import CustomiseFeed from "../Layout/CustomiseFeed";
import { useMediaQuery } from "../Hooks/useMediaQuery";
import { useQuery } from "@tanstack/react-query";
import { listAllGenres } from "@music/sdk";
import { useSearchParams, useRouter } from "next/navigation";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import ListenAgain from "../Home/ListenAgain";
import RecommendedAlbums from "../Home/RecommendedAlbums";
import RandomSongs from "../Home/RandomSongs";
import FromYourLibrary from "../Home/FromYourLibrary";
import MusicVideos from "../Home/MusicVideos";

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

const gradientPalette = [
  // { from: "#1f2937", to: "#111827" }, // Gray 800-900
  // { from: "#374151", to: "#1f2937" }, // Gray 700-800
  // { from: "#374151", to: "#1f2937" }, // Gray 700-800
  // { from: "#4b5563", to: "#374151" }, // Gray 600-700
  // { from: "#18181b", to: "#09090b" }, // Zinc 800-950
  // { from: "#27272a", to: "#18181b" }, // Zinc 700-800
  // { from: "#3f3f46", to: "#27272a" }, // Zinc 600-700
  // { from: "#1e293b", to: "#0f172a" }, // Slate 800-900
  // { from: "#334155", to: "#1e293b" }, // Slate 700-800
  // { from: "#475569", to: "#334155" }, // Slate 600-700
  // { from: "#1c1917", to: "#0c0a09" }, // Stone 800-950
  { from: "#292524", to: "#1c1917" }, // Stone 800-900
  // { from: "#44403c", to: "#292524" }, // Stone 600-800
];

const GenreButton = memo(({ 
  genre, 
  isSelected, 
  onClick,
  index
}: { 
  genre: string; 
  isSelected: boolean; 
  onClick: () => void;
  index: number;
}) => {
  const getGradient = () => {
    const colorPair = gradientPalette[index % gradientPalette.length] || { from: "#292524", to: "#1c1917" };
    return `linear-gradient(45deg, ${colorPair.from}, ${colorPair.to})`;
  };
  
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={`
        px-5 py-2.5 rounded-full whitespace-nowrap text-sm font-medium flex-shrink-0 
        snap-start transition-all duration-200
        ${isSelected 
          ? 'ring-2 ring-white/50 shadow-lg' 
          : 'hover:brightness-110'}
      `}
      style={{
        background: isSelected 
          ? 'linear-gradient(to right, rgba(255,255,255,0.9), rgba(255,255,255,0.8))' 
          : getGradient(),
        color: isSelected ? '#000' : '#fff',
        textShadow: isSelected ? 'none' : '0 1px 2px rgba(0,0,0,0.3)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}
    >
      {capitalizeWords(genre)}
    </motion.button>
  );
});
GenreButton.displayName = 'GenreButton';

interface GenreButtonsProps {
  children: ReactNode;
}

export default function GenreButtons({ children }: GenreButtonsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedGenre = searchParams.get('genre');
  const [showMobileCustomize, setShowMobileCustomize] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  
  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: async () => {
      const genreList = await listAllGenres();
      return genreList.slice(0, 12);
    },
    staleTime: 24 * 60 * 60 * 1000,
  });

  const handleGenreClick = (genre: string) => {
    if (selectedGenre === genre) {
      router.push('/');
    } else {
      router.push(`/?genre=${encodeURIComponent(genre)}`);
    }
  };

  return (
    <div className="relative w-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-white">{}</h2>
        
        {!isMobile && (
          <div className="flex items-center gap-2">
            <CustomiseFeed />
          </div>
        )}
      </div>

      <ScrollArea className="w-full whitespace-nowrap rounded-md pb-2">
        <div className="flex gap-3 pb-4 snap-x w-max">
          {genres.map((genre, index) => (
            <GenreButton
              key={genre}
              genre={genre}
              isSelected={selectedGenre === genre}
              onClick={() => handleGenreClick(genre)}
              index={index}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="bg-white/5" />
      </ScrollArea>

      {isMobile && (
        <>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowMobileCustomize(true)}
            className="fixed bottom-24 right-4 z-20 bg-black/50 backdrop-blur-lg rounded-full shadow-lg border border-white/20 h-12 w-12"
          >
            <Settings className="w-5 h-5" />
          </Button>
          
          <AnimatePresence>
            {showMobileCustomize && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowMobileCustomize(false)}
              >
                <motion.div 
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  className="absolute bottom-0 left-0 right-0 bg-zinc-900 rounded-t-xl p-6 max-h-[85vh] overflow-y-auto"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="w-12 h-1 bg-white/20 mx-auto mb-6 rounded-full"></div>
                  <CustomiseFeed 
                    onClose={() => setShowMobileCustomize(false)}
                    isMobileSheet={true}
                  />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      
      {selectedGenre && (
        <>
          <ListenAgain genre={selectedGenre} />
          <RecommendedAlbums genre={selectedGenre} />
          <RandomSongs genre={selectedGenre} />
          <FromYourLibrary genre={selectedGenre} />
          <MusicVideos />
        </>
      )}
      {!selectedGenre && children}
    </div>
  );
}