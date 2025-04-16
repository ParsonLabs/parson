import { getSongsWithMusicVideos } from "@music/sdk";
import { MusicVideoSong } from "@music/sdk/types";
import { useEffect, useRef, useState } from "react";
import MusicVideoCard from "@/components/Music/Card/MusicVideoCard";
import { motion, AnimatePresence } from "framer-motion";
import { Video, ArrowLeft, ArrowRight } from "lucide-react";

type ArtistMusicVideosProps = {
  artistName: string;
};

export default function ArtistMusicVideos({ artistName }: ArtistMusicVideosProps) {
  const [videos, setVideos] = useState<MusicVideoSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(true);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const checkScroll = () => {
    if (!scrollContainerRef.current) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setShowLeftScroll(scrollLeft > 20);
    setShowRightScroll(scrollLeft + clientWidth < scrollWidth - 20);
  };

  const handleScrollLeft = () => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({ left: -300, behavior: 'smooth' });
  };

  const handleScrollRight = () => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollBy({ left: 300, behavior: 'smooth' });
  };

  useEffect(() => {
    async function fetchArtistMusicVideos() {
      try {
        const allVideos = await getSongsWithMusicVideos();
        const artistVideos = allVideos.filter(
          video => video.artist.toLowerCase() === artistName.toLowerCase()
        );
        setVideos(artistVideos);
      } catch (error) {
        console.error("Error fetching music videos:", error);
      } finally {
        setLoading(false);
      }
    }

    if (artistName) {
      fetchArtistMusicVideos();
    }
  }, [artistName]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScroll);
      checkScroll();
      
      return () => container.removeEventListener('scroll', checkScroll);
    }
  }, [videos]);

  if (loading) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <h2 className="text-2xl font-bold mb-4 text-white flex items-center gap-2">
          <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
          Music Videos
        </h2>
        <div className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5 shadow-xl">
          <div className="flex space-x-6">
            {[...Array(3)].map((_, i) => (
              <div 
                key={i} 
                className="w-[320px] h-[220px] bg-gray-800/50 rounded-lg animate-pulse"
              />
            ))}
          </div>
        </div>
      </motion.div>
    );
  }

  if (videos.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="mb-12 relative w-full"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
          Music Videos
          <span className="ml-3 text-sm bg-white/10 px-2.5 py-1 rounded-full text-gray-300">
            {videos.length}
          </span>
        </h2>
      </div>

      <div className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5 shadow-xl relative">
        <AnimatePresence>
          {showLeftScroll && isHovered && (
            <motion.button
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
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
          {showRightScroll && isHovered && (
            <motion.button
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
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
          className="overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-4 max-w-full" 
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          onScroll={checkScroll}
        >
          <div className="flex space-x-4 max-w-2xl">
            {videos.map((video, index) => (
              <motion.div
                key={video.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.06,
                  ease: [0.23, 1, 0.32, 1]
                }}
                whileHover={{
                  y: -12,
                  transition: { duration: 0.2 },
                }}
                className="snap-start shrink-0 w-[320px] group"
              >
                <div className="relative overflow-hidden rounded-xl shadow-xl shadow-black/40 transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-purple-900/20">
                  <MusicVideoCard song={video} />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-black/80 to-transparent pointer-events-none z-10" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-black/80 to-transparent pointer-events-none z-10" />
      </div>
    </motion.div>
  );
}