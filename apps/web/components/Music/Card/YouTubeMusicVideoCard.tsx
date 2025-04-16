"use client";

import { getSongInfo } from "@music/sdk";
import { LibrarySong, MusicVideoSong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@music/ui/components/dialog";
import { Video, Play, Clock, X, MoreVertical, CheckCircle, Check, CircleCheck, BadgeCheck } from "lucide-react";
import ReactPlayer from 'react-player/youtube';
import { usePlayer } from "../Player/usePlayer";
import { motion } from "framer-motion";
import { Button } from "@music/ui/components/button";
import formatDuration from "@/lib/Formatting/formatDuration";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import { FastAverageColor } from 'fast-average-color';
import { format } from 'date-fns';
import getBaseURL from "@/lib/Server/getBaseURL";

type YouTubeMusicVideoCardProps = {
  song: MusicVideoSong;
};

export default function YouTubeMusicVideoCard({ song }: YouTubeMusicVideoCardProps) {
  const [songInfo, setSongInfo] = useState<LibrarySong>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [viewCount, setViewCount] = useState<string>(
    Math.floor(Math.random() * 10000000).toLocaleString()
  );
  const [uploadDate, setUploadDate] = useState<string>('');
  const { setGradientWithTransition } = useGradientHover();
  const { togglePlayPause, setAudioSource, setSong, setAlbum, setArtist, setImageSrc } = usePlayer();

  const getVideoId = useCallback((url: string) => {
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname === 'www.youtube.com' || urlObj.hostname === 'youtube.com') {
        return urlObj.searchParams.get('v');
      } else if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.slice(1);
      }
    } catch (error) {
      console.error('Invalid URL:', url);
      return null;
    }
    return null;
  }, []);

  const videoId = song?.music_video ? getVideoId(song.music_video.url) : null;
  const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : "";

useEffect(() => {
    async function fetchSongInfo() {
        try {
            const fetchedSongInfo = await getSongInfo(song.id, false) as LibrarySong;
            setSongInfo(fetchedSongInfo);
            console.log("fetched ", fetchedSongInfo)

            if (songInfo?.album_object.first_release_date) {
                setUploadDate(format(new Date(songInfo.album_object.first_release_date), 'MMM d, yyyy'));
            } else {
                const now = new Date();
                const twoYearsAgo = new Date();
                twoYearsAgo.setFullYear(now.getFullYear() - 2);
                const randomDate = new Date(
                    twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime())
                );
                setUploadDate(format(randomDate, 'MMM d, yyyy'));
            }
        } catch (error) {
            console.error("Failed to fetch song info:", error);
        }
    }

    fetchSongInfo();
}, [song.id, songInfo?.album_object.first_release_date]);

  useEffect(() => {
    if (isDialogOpen && thumbnailUrl) {
      const extractColor = async () => {
        try {
          const fac = new FastAverageColor();
          const color = await fac.getColorAsync(thumbnailUrl);
          setGradientWithTransition(color.hex);
        } catch (error) {
          console.error("Failed to extract color:", error);
        }
      };
      
      extractColor();
    }
  }, [isDialogOpen, setGradientWithTransition, thumbnailUrl]);

  if (!song || !song.music_video) return null;

  const handlePlayAudio = () => {
    if (songInfo) {
      const albumCoverURL =
        songInfo.album_object.cover_url.length === 0
          ? "/snf.png"
          : `${getBaseURL()}/image/${encodeURIComponent(songInfo.album_object.cover_url)}?raw=true`;

      setSong(songInfo);
      setAlbum(songInfo.album_object);
      setArtist(songInfo.artist_object);
      setImageSrc(albumCoverURL);
      setAudioSource(songInfo.path);
      setTimeout(() => togglePlayPause(), 100);
    }
  };

  const handlePlayerReady = (player: any) => {
    try {
      const duration = player.getDuration();
      setVideoDuration(duration);
    } catch (error) {
      console.error("Could not get video duration:", error);
    }
  };

  const formatViewCount = (count: string) => {
    const num = parseInt(count.replace(/,/g, ''));
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M views`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K views`;
    }
    return `${num} views`;
  };

  return (
    <div className="w-full">
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <motion.div
            className="cursor-pointer group"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <div className="relative w-full rounded-xl overflow-hidden aspect-video mb-3">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <div className="w-8 h-8 border-4 border-t-indigo-500 border-r-transparent border-b-indigo-300 border-l-transparent rounded-full animate-spin"></div>
                </div>
              )}
              
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <div className="text-center p-4">
                    <Video className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-300 text-sm">Video unavailable</p>
                  </div>
                </div>
              )}
              
              <Image
                src={thumbnailUrl}
                fill
                alt={`${song.name} Music Video`}
                className={`object-cover transition-transform duration-300 ${isHovered ? 'scale-110' : 'scale-100'}`}
                loading="lazy"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />

              {videoDuration && (
                <div className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                  {formatDuration(videoDuration)}
                </div>
              )}

              <div 
                className={`absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 transition-opacity duration-200 ${isHovered ? 'opacity-100' : ''}`}
              >
                <div className="bg-black/60 rounded-full p-3">
                  <Play className="w-8 h-8 text-white" fill="white" />
                </div>
              </div>
            </div>

            <div className="flex">
              <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 mr-3 mt-0.5">
                <Image
                  src={songInfo?.artist_object?.icon_url?.length ? 
                    `${getBaseURL()}/image/${encodeURIComponent(songInfo.artist_object.icon_url)}` : 
                    "/snf.png"}
                  width={36}
                  height={36}
                  alt={songInfo?.artist_object?.name || "Channel"}
                  className="object-cover"
                />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-white text-[15px] line-clamp-2 mb-1 leading-tight">
                  {song.name}
                </h3>
                
                <div className="flex items-center text-[13px] text-zinc-400 mb-0.5">
                  <span className="truncate max-w-[120px]">
                    {songInfo?.artist_object?.name || "Unknown Artist"}
                  </span>
                  <BadgeCheck className="w-3.5 h-3.5 ml-1 "  />
                </div>
                
                <div className="text-[13px] text-zinc-400">
                  {formatViewCount(viewCount)} • {uploadDate}
                </div>
              </div>
              
              <button 
                className="p-1.5 rounded-full hover:bg-zinc-800 self-start mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <MoreVertical className="w-5 h-5 text-white" />
              </button>
            </div>
          </motion.div>
        </DialogTrigger>

        <DialogContent className="max-w-5xl h-[85vh] bg-black border-zinc-800 p-0 overflow-hidden">
          <div className="absolute top-3 right-3 z-10">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setIsDialogOpen(false)} 
              className="rounded-full bg-black/50 hover:bg-black/70 text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>

          <div className="w-full h-full">
            <ReactPlayer 
              controls
              width="100%"
              height="100%"
              pip={true}
              playing={isDialogOpen}
              url={song.music_video.url}
              onReady={handlePlayerReady}
              config={{
                playerVars: { 
                  autoplay: 1,
                  modestbranding: 1,
                  rel: 0
                }
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}