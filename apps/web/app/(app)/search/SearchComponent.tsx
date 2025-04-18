"use client";

import HorizontalCard from "@/components/Music/Card/HorizontalCard";
import TopResultsCard from "@/components/Music/Card/Search/TopResultsCard";
import {
  searchLibrary,
  searchYouTube,
  searchGenius,
  GeniusSearchResult,
  GeniusSongResponse,
  getSongInfo,
} from "@music/sdk";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  YoutubeIcon,
  MusicIcon,
  AlbumIcon,
  UsersIcon,
  Search,
  ExternalLink,
  MicVocal,
} from "lucide-react";
import Image from "next/image";
import { usePlayer } from "@/components/Music/Player/usePlayer";
import { Play, Pause } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsList, TabsTrigger } from "@music/ui/components/tabs";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import { FastAverageColor } from "fast-average-color";
import YouTubeMiniPlayer from "@/components/Music/Player/YouTubeMiniPlayer";
import React from "react";
import { Button } from "@music/ui/components/button";
import { useRouter } from "next/navigation";
import { Song } from "@music/sdk/types";
import getBaseURL from "@/lib/Server/getBaseURL";

function YoutubeResultCard({ video }: { video: YouTubeVideo }) {
  const [isHovered, setIsHovered] = useState(false);
  const {
    setImageSrc,
    setSong,
    setArtist,
    setAlbum,
    setAudioSource,
    isPlaying,
    song: currentSong,
    togglePlayPause,
    playAudioSource,
  } = usePlayer();

  const videoId = video.url.split("v=")[1] || video.id;
  const isCurrentlyPlaying =
    currentSong?.id === `youtube-${videoId}` && isPlaying;

  const handlePlayYouTube = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setImageSrc(video.thumbnail);

    const youtubeSong = {
      id: `youtube-${videoId}`,
      name: video.title,
      artist: video.channel.name,
      path: video.url,
      duration: 0,
      music_video: { url: video.url },
      album_object: {
        cover_url: video.thumbnail,
        name: "YouTube",
        id: "youtube",
      },
      artist_object: {
        name: video.channel.name,
        id: "youtube",
      },
    };

    setSong(youtubeSong);
    setArtist({
      name: video.channel.name,
      id: "youtube",
      icon_url: video.thumbnail,
    });
    setAlbum({
      name: "YouTube",
      id: "youtube",
      cover_url: video.thumbnail,
    });

    setAudioSource(video.url);
    togglePlayPause();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex items-center p-3 rounded-lg cursor-pointer relative group overflow-hidden
        ${isCurrentlyPlaying ? "bg-white/10 ring-1 ring-white/20" : "hover:bg-white/10"}
        transition-all duration-300 transform hover:translate-x-1`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePlayYouTube}
    >
      {isCurrentlyPlaying && (
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 to-purple-500/10 z-0" />
      )}

      <div className="relative flex-shrink-0 rounded-md overflow-hidden shadow-lg">
        <div className="absolute top-1.5 right-1.5 z-20 bg-red-600 rounded text-[10px] font-bold py-0.5 px-1.5 text-white opacity-80">
          YT
        </div>

        <motion.div
          animate={{ scale: isHovered ? 1.05 : 1 }}
          transition={{ duration: 0.3 }}
          className="relative"
        >
          <Image
            src={video.thumbnail}
            alt={video.title}
            width={192}
            height={108}
            className={`w-24 h-[54px] object-cover ${
              isHovered || isCurrentlyPlaying
                ? "brightness-80"
                : "brightness-90"
            } transition-all duration-300 rounded-md`}
            onError={(e) => {
              e.currentTarget.src = "/fallback-thumbnail.png";
            }}
          />

          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/60 to-transparent ${
              isHovered ? "opacity-100" : "opacity-80"
            } transition-opacity duration-300 rounded-md`}
          />
        </motion.div>

        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
            isHovered || isCurrentlyPlaying ? "opacity-100" : "opacity-0"
          } z-10`}
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={`bg-white/20 backdrop-blur-sm p-2 rounded-full shadow-lg 
              ${isCurrentlyPlaying ? "bg-red-500/30" : "bg-black/40"}`}
          >
            {isCurrentlyPlaying ? (
              <Pause className="w-5 h-5 text-white fill-white drop-shadow-md" />
            ) : (
              <Play className="w-5 h-5 text-white fill-white drop-shadow-md ml-0.5" />
            )}
          </motion.div>
        </div>

        {isCurrentlyPlaying && (
          <div className="absolute bottom-1 left-0 right-0 flex justify-center">
            <div className="flex gap-0.5 px-1.5 py-1 bg-black/70 backdrop-blur-md rounded-full">
              <motion.div
                animate={{ height: ["3px", "8px", "3px"] }}
                transition={{ repeat: Infinity, duration: 0.8, delay: 0 }}
                className="w-0.5 bg-red-500 rounded-full"
              ></motion.div>
              <motion.div
                animate={{ height: ["3px", "12px", "3px"] }}
                transition={{ repeat: Infinity, duration: 0.8, delay: 0.2 }}
                className="w-0.5 bg-red-400 rounded-full"
              ></motion.div>
              <motion.div
                animate={{ height: ["3px", "6px", "3px"] }}
                transition={{ repeat: Infinity, duration: 0.8, delay: 0.4 }}
                className="w-0.5 bg-red-500 rounded-full"
              ></motion.div>
            </div>
          </div>
        )}
      </div>

      <div className="ml-3 flex-grow min-w-0 relative z-10">
        <p
          className={`text-sm font-medium truncate leading-snug transition-colors duration-300
          ${
            isCurrentlyPlaying
              ? "bg-gradient-to-r from-white via-white to-red-200 bg-clip-text text-transparent"
              : "text-white group-hover:text-white"
          }`}
        >
          {video.title}
        </p>

        <p className="text-xs text-gray-400 truncate flex items-center gap-1.5 mt-0.5">
          <YoutubeIcon className="w-3 h-3 text-red-500" />
          <span className="group-hover:text-gray-300 transition-colors duration-300">
            {video.channel.name}
          </span>
        </p>
      </div>

      <motion.div
        className="ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        animate={{ opacity: isHovered || isCurrentlyPlaying ? 1 : 0 }}
      >
        <motion.div
          whileHover={{ scale: 1.1, rotate: 15 }}
          whileTap={{ scale: 0.9 }}
          className="text-gray-400 group-hover:text-white"
        >
          <ExternalLink className="w-4 h-4" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
YoutubeResultCard.displayName = "YoutubeResultCard";

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: {
    name: string;
  };
  url: string;
}

interface GeniusResultCardProps {
  result: GeniusSearchResult;
  query: string;
}

function GeniusResultCard({ result, query }: GeniusResultCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const {
    setSong,
    setAlbum,
    setArtist,
    setImageSrc,
    setAudioSource,
    playAudioSource,
  } = usePlayer();

  const getHighlightedSnippet = () => {
    if (!result.lyrics_snippet || !query) {
      return result.lyrics_snippet?.replace(/\n/g, "<br />") || "";
    }
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`(${escapedQuery})`, "gi");
    return result.lyrics_snippet
      .replace(regex, `<strong class="text-yellow-300">$1</strong>`)
      .replace(/\n/g, "<br />");
  };

  const handlePlayMatchedSong = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSearching(true);
    try {
      const searchQuery = `${result.title} ${result.artist}`;
      console.log("Searching library for:", searchQuery);

      const libraryResults = await searchLibrary(searchQuery);

      const matchedSong = libraryResults.find(
        (item) => item.item_type === "song"
      );

      if (matchedSong && matchedSong.song_object) {
        const imageSrc =
          matchedSong.album_object?.cover_url?.length === 0
            ? "/snf.png"
            : `${getBaseURL()}/image/${encodeURIComponent(matchedSong?.album_object?.cover_url ?? "")}`;
        setImageSrc(imageSrc);
        const songInfo = await getSongInfo(matchedSong.id);
        setSong(songInfo as unknown as Song);
        setArtist({
          id: matchedSong?.artist_object?.id,
          name: matchedSong?.artist_object?.name,
        });
        setAlbum({
          id: matchedSong?.album_object?.id,
          name: matchedSong.album_object?.name,
          cover_url: imageSrc,
        });
        const audioSource = `${getBaseURL()}/api/stream/${encodeURIComponent(songInfo.path)}?bitrate=0`;
        setAudioSource(audioSource);
        playAudioSource();
      } else {
        console.log("No matching song found in library for:", searchQuery);
      }
    } catch (error) {
      console.error("Error searching library or playing song:", error);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex items-center p-3 rounded-lg cursor-pointer relative group overflow-hidden hover:bg-white/10 transition-all duration-300 transform hover:translate-x-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePlayMatchedSong}
    >
      {isSearching && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-30">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400"></div>
        </div>
      )}
      <div className="relative flex-shrink-0 rounded-md overflow-hidden shadow-lg">
        <div className="absolute top-1.5 right-1.5 z-20 bg-yellow-400 rounded text-[10px] font-bold py-0.5 px-1.5 text-black opacity-80">
          LYRICS
        </div>
        <motion.div
          animate={{ scale: isHovered ? 1.05 : 1 }}
          transition={{ duration: 0.3 }}
          className="relative"
        >
          <Image
            src={result.thumbnail || "/fallback-thumbnail.png"}
            alt={result.title}
            width={64}
            height={64}
            className={`w-16 h-16 object-cover ${
              isHovered ? "brightness-80" : "brightness-90"
            } transition-all duration-300 rounded-md`}
            onError={(e) => {
              e.currentTarget.src = "/fallback-thumbnail.png";
            }}
          />
          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/60 to-transparent ${
              isHovered ? "opacity-100" : "opacity-80"
            } transition-opacity duration-300 rounded-md`}
          />
        </motion.div>
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
            isHovered ? "opacity-100" : "opacity-0"
          } z-10`}
        >
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="bg-black/40 backdrop-blur-sm p-2 rounded-full shadow-lg"
          >
            <Play className="w-5 h-5 text-white fill-white drop-shadow-md ml-0.5" />
          </motion.div>
        </div>
      </div>

      <div className="ml-3 flex-grow min-w-0 relative z-10">
        <p className="text-sm font-medium truncate leading-snug text-white group-hover:text-yellow-300 transition-colors duration-300">
          {result.title}
        </p>
        <p className="text-xs text-gray-400 truncate flex items-center gap-1.5 mt-0.5">
          <span className="group-hover:text-gray-300 transition-colors duration-300">
            {result.artist}
          </span>
        </p>
        {result.lyrics_snippet && (
          <p
            className="text-xs text-gray-500 italic truncate mt-1"
            dangerouslySetInnerHTML={{ __html: getHighlightedSnippet() }}
          />
        )}
      </div>
      <motion.div
        className="ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        animate={{ opacity: isHovered ? 1 : 0 }}
      >
        <motion.div
          whileHover={{ scale: 1.1, rotate: 15 }}
          whileTap={{ scale: 0.9 }}
          className="text-gray-400 group-hover:text-white"
          title="View on Genius.com"
          onClick={(e) => {
            e.stopPropagation();
            window.open(result.url, "_blank");
          }}
        >
          <ExternalLink className="w-4 h-4" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

GeniusResultCard.displayName = "GeniusResultCard";

const HorizontalCardSkeleton = () => (
  <div className="w-full text-white flex items-center animate-pulse p-2">
    <div
      className="bg-gray-700 rounded-lg"
      style={{ width: 64, height: 64 }}
    ></div>
    <div className="ml-4">
      <div className="bg-gray-700 h-5 w-32 mb-2 rounded"></div>
      <div className="bg-gray-700 h-4 w-48 rounded"></div>
    </div>
  </div>
);

const TopResultCardSkeleton = () => (
  <div
    className="relative rounded-xl overflow-hidden bg-white/5 backdrop-blur-md animate-pulse w-full"
    style={{ height: 350 }}
  >
    <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-gray-800"></div>
    <div className="relative z-10 flex flex-col md:flex-row items-center justify-center p-8 gap-8 h-full">
      <div
        className="bg-gray-700 rounded-lg"
        style={{ width: 200, height: 200 }}
      ></div>
      <div className="space-y-4">
        <div className="bg-gray-700 h-10 w-64 rounded"></div>
        <div className="bg-gray-700 h-6 w-48 rounded"></div>
        <div className="bg-gray-700 h-10 w-32 rounded-full mt-6"></div>
      </div>
    </div>
  </div>
);

export default function SearchComponent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") ?? "";
  const router = useRouter();

  const trendingSearches = [
    "Hip Hop",
    "R&B",
    "Pop",
    "Rock",
    "Jazz",
    "Classical",
    "Electronic",
    "Country",
    "Reggae",
    "Soul",
    "Blues",
    "Dance",
    "Funk",
    "Disco",
  ];

  const handleQuickSearch = (term: string) => {
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [youtubeResults, setYoutubeResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState<boolean>(true);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [geniusResults, setGeniusResults] = useState<GeniusSearchResult[]>([]);
  const [geniusLoading, setGeniusLoading] = useState<boolean>(true);
  const [geniusError, setGeniusError] = useState<string | null>(null);
  const [activeLyrics, setActiveLyrics] = useState<GeniusSongResponse | null>(
    null
  );
  const [activeYouTubeVideo, setActiveYouTubeVideo] =
    useState<YouTubeVideo | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");

  const totalResults = useMemo(
    () => results.length + youtubeResults.length + geniusResults.length,
    [results.length, youtubeResults.length, geniusResults.length]
  );

  const totalResultsMessage = useMemo(() => {
    const parts = [];
    if (results.length > 0) parts.push(`${results.length} in library`);
    if (youtubeResults.length > 0)
      parts.push(`${youtubeResults.length} on YouTube`);
    if (geniusResults.length > 0)
      parts.push(`${geniusResults.length} lyrics on Genius`);

    if (parts.length === 0) return "No results found";
    if (parts.length === 1) return `Found ${parts[0]}`;

    return `Found ${parts.slice(0, -1).join(", ")} and ${parts.slice(-1)}`;
  }, [results.length, youtubeResults.length, geniusResults.length]);

  useEffect(() => {
    let isMounted = true;

    async function getSearchResults() {
      if (!isMounted) return;

      setLoading(true);
      setYoutubeLoading(true);
      setGeniusLoading(true);
      setError(null);
      setYoutubeError(null);
      setGeniusError(null);

      try {
        const searchResults = await searchLibrary(query);
        if (!isMounted) return;
        setResults(searchResults);
      } catch (err) {
        if (!isMounted) return;
        console.error("Search error:", err);
        setError("Failed to load search results");
      } finally {
        if (isMounted) setLoading(false);
      }

      try {
        const ytResults = await searchYouTube(query);
        if (!isMounted) return;
        setYoutubeResults(ytResults);
      } catch (err) {
        if (!isMounted) return;
        console.error("YouTube error:", err);
        setYoutubeError("Failed to load YouTube results");
      } finally {
        if (isMounted) setYoutubeLoading(false);
      }

      try {
        const geniusData = await searchGenius(query);
        if (!isMounted) return;
        setGeniusResults(geniusData.results);
      } catch (err) {
        if (!isMounted) return;
        console.error("Genius error:", err);
        setGeniusError("Failed to load Genius results");
      } finally {
        if (isMounted) setGeniusLoading(false);
      }
    }

    if (query) {
      getSearchResults();
    } else {
      setResults([]);
      setYoutubeResults([]);
      setGeniusResults([]);
      setLoading(false);
      setYoutubeLoading(false);
      setGeniusLoading(false);
    }

    return () => {
      isMounted = false;
    };
  }, [query]);

  const filteredResults = useMemo(
    () =>
      activeTab === "all"
        ? results.slice(1)
        : results
            .slice(1)
            .filter((result: any) => result.item_type === activeTab),
    [activeTab, results]
  );

  const counts = useMemo(
    () => ({
      all: results.slice(1).length,
      song: results.slice(1).filter((r: any) => r.item_type === "song").length,
      album: results.slice(1).filter((r: any) => r.item_type === "album")
        .length,
      artist: results.slice(1).filter((r: any) => r.item_type === "artist")
        .length,
    }),
    [results]
  );

  const backgroundImageSource = useMemo(
    () => results[0]?.album_object?.cover_url ?? "/snf.png",
    [results]
  );

  if (!query) {
    return (
      <div className="relative min-h-screen">
        <div className="fixed inset-0 bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800" />

        <div className="fixed inset-0 opacity-10">
          <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 blur-3xl transform -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 left-0 h-64 bg-gradient-to-r from-rose-500 via-amber-500 to-orange-500 blur-3xl transform translate-y-1/2" />
        </div>

        <div className="relative z-10 pt-20 pb-40 px-4 md:px-8">
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-12"
            >
              <h1 className="text-5xl font-bold text-white mb-4">
                Discover Your Perfect Sound
              </h1>
              <p className="text-xl text-gray-300 max-w-xl mx-auto">
                Search for your favorite songs, artists, or albums in our
                extensive music library.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mb-16"
            >
              <div className="relative max-w-2xl mx-auto">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const input = e.currentTarget.querySelector("input");
                    if (input && input.value.trim()) {
                      router.push(
                        `/search?q=${encodeURIComponent(input.value.trim())}`
                      );
                    }
                  }}
                  className="group"
                >
                  <input
                    type="text"
                    placeholder="What do you want to listen to?"
                    className="w-full h-16 pl-14 pr-20 rounded-full bg-white/10 border-2 border-white/20 text-white text-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                    autoFocus
                  />
                  <div className="absolute left-5 top-1/2 transform -translate-y-1/2 text-gray-400">
                    <Search className="w-6 h-6" />
                  </div>
                  <Button
                    type="submit"
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-full px-6 py-2"
                  >
                    Search
                  </Button>
                </form>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <h2 className="text-2xl font-bold text-white mb-6 text-center">
                Trending Searches
              </h2>
              <div className="flex flex-wrap justify-center gap-3">
                {trendingSearches.map((term, index) => (
                  <motion.div
                    key={term}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 + index * 0.05 }}
                  >
                    <Button
                      variant="outline"
                      onClick={() => handleQuickSearch(term)}
                      className="bg-white/10 hover:bg-white/20 border-white/5 text-white rounded-full transition-all duration-300 hover:scale-105"
                    >
                      {term}
                    </Button>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-16"
            >
              <h2 className="text-2xl font-bold text-white mb-8 text-center">
                Browse Categories
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    name: "Top Charts",
                    icon: "🏆",
                    color: "from-pink-600 to-rose-600",
                  },
                  {
                    name: "New Releases",
                    icon: "🆕",
                    color: "from-blue-600 to-cyan-600",
                  },
                  {
                    name: "Podcasts",
                    icon: "🎙️",
                    color: "from-green-600 to-emerald-600",
                  },
                  {
                    name: "Your Playlists",
                    icon: "📂",
                    color: "from-amber-600 to-yellow-600",
                  },
                ].map((category, index) => (
                  <motion.div
                    key={category.name}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.98 }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                    onClick={() => handleQuickSearch(category.name)}
                    className={`bg-gradient-to-br ${category.color} rounded-xl p-6 text-center cursor-pointer`}
                  >
                    <div className="text-3xl mb-2">{category.icon}</div>
                    <h3 className="text-lg font-semibold text-white">
                      {category.name}
                    </h3>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />

      <div
        className="fixed inset-0 opacity-30 will-change-transform"
        style={{
          backgroundImage: `url(${backgroundImageSource})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(140px)",
          transform: "translateZ(0)",
        }}
      />

      <div className="relative z-10 px-4 md:px-8 pt-16 pb-40 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto">
          <motion.div
            className="mb-6"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-3xl font-bold text-white mb-2 flex items-center">
              <Search className="mr-3 w-6 h-6 text-gray-400" />
              Results for &ldquo;{query}&rdquo;
            </h1>

            <p className="text-gray-400">{totalResultsMessage}</p>
          </motion.div>

          <motion.div
            className="mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {loading ? (
              <TopResultCardSkeleton />
            ) : (
              results && results[0] && <TopResultsCard result={results[0]} />
            )}
          </motion.div>

          <Tabs
            defaultValue="all"
            value={activeTab}
            onValueChange={setActiveTab}
            className="mb-8"
          >
            <TabsList className="bg-black/40 backdrop-blur-md p-1 rounded-lg">
              <TabsTrigger
                value="all"
                className="data-[state=active]:bg-white/20 data-[state=active]:text-white rounded-md"
              >
                All ({counts.all})
              </TabsTrigger>
              <TabsTrigger
                value="song"
                className="data-[state=active]:bg-white/20 data-[state=active]:text-white rounded-md"
                disabled={counts.song === 0}
              >
                <MusicIcon className="w-4 h-4 mr-1" />
                Songs ({counts.song})
              </TabsTrigger>
              <TabsTrigger
                value="album"
                className="data-[state=active]:bg-white/20 data-[state=active]:text-white rounded-md"
                disabled={counts.album === 0}
              >
                <AlbumIcon className="w-4 h-4 mr-1" />
                Albums ({counts.album})
              </TabsTrigger>
              <TabsTrigger
                value="artist"
                className="data-[state=active]:bg-white/20 data-[state=active]:text-white rounded-md"
                disabled={counts.artist === 0}
              >
                <UsersIcon className="w-4 h-4 mr-1" />
                Artists ({counts.artist})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,500px] gap-8">
            <div>
              {loading ? (
                <div className="space-y-4 p-6 bg-black/40 backdrop-blur-md rounded-xl">
                  {[...Array(6)].map((_, i) => (
                    <HorizontalCardSkeleton key={i} />
                  ))}
                </div>
              ) : error ? (
                <div className="p-12 text-center bg-black/40 backdrop-blur-md rounded-xl">
                  <p className="text-gray-400">{error}</p>
                </div>
              ) : filteredResults.length > 0 ? (
                <motion.div
                  className="bg-black/40 backdrop-blur-md rounded-xl overflow-hidden"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="p-5">
                    <AnimatePresence mode="wait">
                      <div className="space-y-1">
                        {filteredResults.map((result: any, index: number) => (
                          <motion.div
                            key={result.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: index * 0.05 }}
                            exit={{ opacity: 0, y: -10 }}
                          >
                            <HorizontalCard item={result} />
                          </motion.div>
                        ))}
                      </div>
                    </AnimatePresence>
                  </div>
                </motion.div>
              ) : (
                <div className="p-12 text-center bg-black/40 backdrop-blur-md rounded-xl">
                  <p className="text-gray-400">
                    No matching{" "}
                    {activeTab === "all" ? "items" : activeTab + "s"} found
                  </p>
                </div>
              )}
            </div>

            <div>
              <div className="mb-8">
                {geniusLoading ? (
                  <div className="space-y-4 p-6 bg-black/40 backdrop-blur-md rounded-xl">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-bold bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500 bg-clip-text text-transparent animate-pulse">
                        Loading Genius Results...
                      </h2>
                      <MicVocal className="w-5 h-5 text-yellow-500" />
                    </div>
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex animate-pulse">
                        <div className="w-16 h-16 rounded bg-gray-700"></div>
                        <div className="ml-4">
                          <div className="h-4 w-48 bg-gray-700 rounded mb-2"></div>
                          <div className="h-3 w-32 bg-gray-700 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : geniusError ? (
                  <div className="p-8 text-center bg-black/40 backdrop-blur-md rounded-xl">
                    <MicVocal className="w-10 h-10 text-yellow-600 mx-auto mb-3 opacity-50" />
                    <p className="text-gray-400">{geniusError}</p>
                  </div>
                ) : geniusResults.length > 0 ? (
                  <motion.div
                    className="bg-black/40 backdrop-blur-md rounded-xl overflow-hidden"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.3 }}
                  >
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-bold bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500 bg-clip-text text-transparent">
                          Lyrics from Genius
                        </h2>
                        <MicVocal className="w-5 h-5 text-yellow-500" />
                      </div>
                      <div className="space-y-2">
                        {geniusResults.map((result) => (
                          <GeniusResultCard
                            result={result}
                            key={result.id}
                            query={query}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  query &&
                  !geniusLoading && (
                    <div className="p-8 text-center bg-black/40 backdrop-blur-md rounded-xl">
                      <MicVocal className="w-10 h-10 text-yellow-600/50 mx-auto mb-3 opacity-50" />
                      <p className="text-gray-400">No lyrics found on Genius</p>
                    </div>
                  )
                )}
              </div>

              <div>
                {youtubeLoading ? (
                  <div className="space-y-4 p-6 bg-black/40 backdrop-blur-md rounded-xl">
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent animate-pulse">
                        Loading YouTube Results...
                      </h2>
                      <YoutubeIcon className="w-5 h-5 text-red-600" />
                    </div>
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex animate-pulse">
                        <div className="w-24 h-16 rounded bg-gray-700"></div>
                        <div className="ml-4">
                          <div className="h-4 w-48 bg-gray-700 rounded mb-2"></div>
                          <div className="h-3 w-32 bg-gray-700 rounded"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : youtubeError ? (
                  <div className="p-8 text-center bg-black/40 backdrop-blur-md rounded-xl">
                    <YoutubeIcon className="w-10 h-10 text-red-600 mx-auto mb-3 opacity-50" />
                    <p className="text-gray-400">{youtubeError}</p>
                  </div>
                ) : youtubeResults.length > 0 ? (
                  <motion.div
                    className="bg-black/40 backdrop-blur-md rounded-xl overflow-hidden"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                  >
                    <div className="p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <h2 className="text-lg font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
                          From YouTube
                        </h2>
                        <YoutubeIcon className="w-5 h-5 text-red-600" />
                      </div>
                      <div className="space-y-2">
                        {youtubeResults.map((video, index) => (
                          <YoutubeResultCard video={video} key={video.id} />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <div className="p-8 text-center bg-black/40 backdrop-blur-md rounded-xl">
                    <YoutubeIcon className="w-10 h-10 text-red-600/50 mx-auto mb-3 opacity-50" />
                    <p className="text-gray-400">No YouTube videos found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeYouTubeVideo && (
        <YouTubeMiniPlayer
          video={activeYouTubeVideo}
          onClose={() => setActiveYouTubeVideo(null)}
        />
      )}
    </div>
  );
}
