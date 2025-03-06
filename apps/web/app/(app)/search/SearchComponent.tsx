"use client";

import HorizontalCard from "@/components/Music/Card/HorizontalCard";
import TopResultsCard from "@/components/Music/Card/Search/TopResultsCard";
import { searchLibrary, searchYouTube } from "@music/sdk";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import PageGradient from "@/components/Layout/PageGradient";
import { Dialog, DialogFooter } from "@music/ui/components/dialog";
import { DialogContent, DialogTrigger } from "@radix-ui/react-dialog";
import { YoutubeIcon } from "lucide-react";
import Image from "next/image";
import ReactPlayer from "react-player";
import { usePlayer } from "@/components/Music/Player/usePlayer";
import { Play, Pause } from "lucide-react";
import YouTubeMiniPlayer from "@/components/Music/Player/YouTubeMiniPlayer";

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: {
    name: string;
  };
  url: string;
}

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
    togglePlayPause
  } = usePlayer();
  
  const videoId = video.url.split('v=')[1] || video.id;
  const isCurrentlyPlaying = currentSong?.id === `youtube-${videoId}` && isPlaying;

  const handlePlayYouTube = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentSong?.id === `youtube-${videoId}`) {
      togglePlayPause();
      return;
    }

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
        id: "youtube"
      },
      artist_object: {
        name: video.channel.name,
        id: "youtube",
      }
    };
    
    setSong(youtubeSong);
    setArtist({
      name: video.channel.name,
      id: "youtube",
      icon_url: video.thumbnail
    });
    setAlbum({
      name: "YouTube",
      id: "youtube",
      cover_url: video.thumbnail
    });
    
    setAudioSource(video.url);
    
    if (!isPlaying) {
      setTimeout(() => togglePlayPause(), 100);
    }
  };

  return (
    <div
      className="flex items-center p-4 hover:bg-gray-800 rounded-lg cursor-pointer relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handlePlayYouTube}
    >
      <div className="relative">
        <Image
          src={video.thumbnail}
          alt={video.title}
          width={1920}
          height={1080}
          className={`w-24 h-16 object-cover rounded transition-all duration-300 ${
            isHovered || isCurrentlyPlaying ? "brightness-50" : ""
          }`}
          onError={(e) => {
            e.currentTarget.src = "/fallback-thumbnail.png";
          }}
        />
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          isHovered || isCurrentlyPlaying ? 'opacity-100' : 'opacity-0'
        }`}>
          {isCurrentlyPlaying ? 
            <Pause className="w-8 h-8 text-white" /> : 
            <Play className="w-8 h-8 text-white" />
          }
        </div>
      </div>
      <div className="ml-4 overflow-hidden">
        <p className="text-sm text-white truncate">{video.title}</p>
        <p className="text-xs text-gray-400 truncate">
          {video.channel.name}
        </p>
      </div>
    </div>
  );
}

export default function SearchComponent() {
  const searchParams = useSearchParams();
  const query = searchParams?.get("q") ?? "";

  const [results, setResults] = useState<any[]>([]);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [youtubeResults, setYoutubeResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [youtubeLoading, setYoutubeLoading] = useState<boolean>(true);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [activeYouTubeVideo, setActiveYouTubeVideo] = useState<YouTubeVideo | null>(null);

  useEffect(() => {
    async function getSearchResults() {
      setLoading(true);
      setYoutubeLoading(true);
      setError(null);
      setYoutubeError(null);

      try {
        const searchResults = await searchLibrary(query);
        setResults(searchResults);
      } catch (err) {
        console.error("Search error:", err);
        setError("Failed to load search results");
      } finally {
        setLoading(false);
      }

      try {
        const ytResults = await searchYouTube(query);
        setYoutubeResults(ytResults);
      } catch (err) {
        console.error("YouTube error:", err);
        setYoutubeError("Failed to load YouTube results");
      } finally {
        setYoutubeLoading(false);
      }
    }

    if (query) {
      getSearchResults();
    }
  }, [query]);

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />
      
      <div 
        className="fixed inset-0 opacity-30 will-change-transform"
        style={{
          backgroundImage: `url(${results[0]?.album_object?.cover_url ?? "/snf.png"})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(140px)',
          transform: 'translateZ(0)',
        }}
      />

      <div className="relative z-10 px-4 md:px-8 pt-8 pb-8 backdrop-blur-sm">
        <div className="max-w-8xl mx-auto">
          <div className="mb-8">
            {loading ? (
              <TopResultCardSkeleton />
            ) : (
              results && results[0] && <TopResultsCard result={results[0]} />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-6">
            <div className="space-y-6">
              {loading ? (
                <div className="space-y-4">
                  {[...Array(6)].map((_, i) => (
                    <HorizontalCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <>
                  {results.slice(1).some((result: any) => result.item_type === "song") && (
                    <div className="bg-black/20 rounded-xl p-4">
                      <h2 className="text-2xl font-bold text-white mb-4">Songs</h2>
                      <div className="space-y-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "song")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                        ))}
                      </div>
                    </div>
                  )}

                  {results.slice(1).some((result: any) => result.item_type === "album") && (
                    <div className="bg-black/20 rounded-xl p-4">
                      <h2 className="text-2xl font-bold text-white mb-4">Albums</h2>
                      <div className="space-y-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "album")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                        ))}
                      </div>
                    </div>
                  )}

                  {results.slice(1).some((result: any) => result.item_type === "artist") && (
                    <div className="bg-black/20 rounded-xl p-4">
                      <h2 className="text-2xl font-bold text-white mb-4">Artists</h2>
                      <div className="space-y-2">
                        {results
                          .slice(1)
                          .filter((result: any) => result.item_type === "artist")
                          .map((result: any) => (
                            <HorizontalCard item={result} key={result.id} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {!youtubeError && (youtubeResults.length > 0 || youtubeLoading) && (
              <div className="space-y-6">
                <div className="bg-black/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 bg-clip-text text-transparent">
                      From YouTube
                    </h2>
                    <YoutubeIcon className="w-6 h-6 text-red-600" />
                  </div>
                  <div className="space-y-2">
                    {youtubeResults.map((video) => (
                      <YoutubeResultCard video={video} key={video.id} />
                    ))}
                  </div>
                </div>
              </div>
            )}
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

function HorizontalCardSkeleton() {
  return (
    <div className="w-full text-white flex items-center animate-pulse">
      <div
        className="bg-gray-700 rounded-sm"
        style={{ width: 64, height: 64 }}
      ></div>
      <div className="ml-4">
        <div className="bg-gray-700 h-6 w-32 mb-2 rounded"></div>
        <div className="bg-gray-700 h-4 w-48 rounded"></div>
      </div>
    </div>
  );
}

function TopResultCardSkeleton() {
  return (
    <div
      className="relative flex flex-col items-center p-14 animate-pulse"
      style={{ height: 350, width: 500 }}
    >
      <div
        className="bg-gray-700 blur-3xl"
        style={{
          backgroundColor: "#202020",
          transition: "background background-color 0.5s ease",
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          filter: "blur(10px) brightness(50%)",
          zIndex: "10",
        }}
      />
      <div className="relative z-10">
        <div className="bg-gray-700 h-44 w-44 mb-4 rounded"></div>
        <div className="bg-gray-700 h-6 w-32 mb-2 rounded"></div>
        <div className="bg-gray-700 h-4 w-48 rounded"></div>
      </div>
    </div>
  );
}
