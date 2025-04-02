"use client";

import { getSongInfo } from "@music/sdk";
import { LibrarySong, MusicVideoSong } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger
} from "@music/ui/components/dialog";
import { 
  Video, 
  Play, 
  Clock, 
  X, 
  Share2, 
  Plus, 
  Heart, 
  Download,
  Music,
  MoreHorizontal
} from "lucide-react";
import ReactPlayer from 'react-player/youtube';
import { usePlayer } from "../Player/usePlayer";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@music/ui/components/button";
import formatDuration from "@/lib/Formatting/formatDuration";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import { FastAverageColor } from 'fast-average-color';
import { toast } from "sonner";
import getBaseURL from "@/lib/Server/getBaseURL";

type MusicVideoCardProps = {
  song: MusicVideoSong
};

const SpeedDial = ({ items }: { items: any[] }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative">
      <Button 
        variant="ghost"
        size="icon"
        className="rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 text-white w-8 h-8"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsOpen(!isOpen);
        }}
      >
        <MoreHorizontal className="w-4 h-4" />
      </Button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-48 rounded-lg bg-black/80 backdrop-blur-md shadow-lg ring-1 ring-white/10 overflow-hidden z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              {items.map((item, index) => (
                <motion.button
                  key={index}
                  className="flex items-center w-full px-4 py-2.5 text-sm text-left text-white hover:bg-white/10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    item.action();
                    setIsOpen(false);
                  }}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <item.icon 
                    className={`w-4 h-4 mr-3 ${item.color || "text-gray-400"}`} 
                  />
                  <span>{item.label}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function MusicVideoCard({ song }: MusicVideoCardProps) {
  const [songInfo, setSongInfo] = useState<LibrarySong>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
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
  const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";

  useEffect(() => {
    async function fetchSongInfo() {
      try {
        const fetchedSongInfo = await getSongInfo(song.id, false) as LibrarySong;
        setSongInfo(fetchedSongInfo);
      } catch (error) {
        console.error("Failed to fetch song info:", error);
      }
    }

    fetchSongInfo();
  }, [song.id]);

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

      const artistIconURL =
        songInfo.artist_object.icon_url.length === 0
          ? "/snf.png"
          : `${getBaseURL()}/image/${encodeURIComponent(songInfo.artist_object.icon_url)}?raw=true`;


      setSong(songInfo);
      setAlbum(songInfo.album_object)
      setArtist(songInfo.artist_object)
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

  const speedDialItems = [
    {
      icon: Heart,
      label: "Add to Favorites",
      color: "text-pink-500",
      action: () => toast.success(`Added "${song.name}" to favorites`)
    },
    {
      label: "Add to Playlist",
      color: "text-green-500",
      action: () => toast.success(`Added "${song.name}" to playlist`)
    },
    {
      icon: Share2,
      label: "Share",
      color: "text-blue-500",
      action: () => {
        if (navigator.share) {
          navigator.share({
            title: song.name,
            text: `Check out ${song.name}`,
            url: song.music_video?.url ?? ''
          }).catch(() => toast(`Copied link to clipboard`));
        } else {
          if (song.music_video) {
            navigator.clipboard.writeText(song.music_video.url);
          }
          toast(`Copied link to clipboard`);
        }
      }
    },
    {
      icon: Download,
      label: "Download",
      color: "text-violet-500",
      action: () => toast.info(`Download started for "${song.name}"`)
    },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full shadow-lg m-3"
      style={{ maxWidth: "360px", minWidth: "320px" }}
    >
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <motion.div
            whileHover={{ y: -5 }}
            className="relative group cursor-pointer rounded-xl overflow-hidden bg-black/20 backdrop-blur-sm"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div className="relative w-full" style={{ paddingTop: "62%" }}>
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                  <div className="w-10 h-10 border-4 border-t-indigo-500 border-r-transparent border-b-indigo-300 border-l-transparent rounded-full animate-spin"></div>
                </div>
              )}
              
              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <div className="text-center p-4">
                    <Video className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-300 text-sm">Video preview unavailable</p>
                  </div>
                </div>
              )}
              
              <Image
                src={thumbnailUrl}
                fill
                alt={`${song.name} Music Video`}
                className={`object-cover transition-all duration-300 ${isHovered ? 'scale-105 brightness-75' : 'brightness-90'}`}
                loading="lazy"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setLoading(false);
                  setError(true);
                }}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                priority={false}
              />

              <div className={`absolute top-3 right-3 z-20 transition-opacity duration-300 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                <SpeedDial items={speedDialItems} />
              </div>

              {videoDuration && (
                <div className="absolute bottom-3 right-3 bg-black/70 backdrop-blur-sm text-white text-sm px-2.5 py-1 rounded-md flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1.5" />
                  {formatDuration(videoDuration)}
                </div>
              )}

              <div className="absolute top-3 left-3 bg-red-600 text-white text-xs px-2.5 py-1 rounded-md flex items-center">
                <Video className="w-3.5 h-3.5 mr-1.5" />
                YouTube
              </div>

              <motion.div 
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: isHovered ? 1 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="bg-white/20 backdrop-blur-md p-4 rounded-full"
                >
                  <Play className="w-12 h-12 text-white fill-white" />
                </motion.div>
              </motion.div>
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

      <div className="px-4 py-3.5">
        <div className="flex justify-between items-start">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-lg truncate">
              <Link 
                href={`/album?id=${songInfo?.album_object.id || 0}#${song.name}`}
                className="hover:underline"
              >
                {song.name}
              </Link>
            </h3>
            
            <p className="text-sm text-gray-400 truncate flex-1 mt-1">
              {songInfo?.artist_object?.name ? (
                <Link 
                  href={`/artist?id=${songInfo?.artist_object.id ?? "0"}`}
                  className="hover:text-gray-200 transition-colors"
                >
                  {songInfo?.artist_object.name}
                </Link>
              ) : "Unknown Artist"}
              
              {songInfo?.album_object?.name && (
                <>
                  <span className="mx-1">•</span>
                  <Link 
                    href={`/album?id=${songInfo?.album_object.id || 0}`}
                    className="hover:text-gray-200 transition-colors"
                  >
                    {songInfo.album_object.name}
                  </Link>
                </>
              )}
            </p>
          </div>
          
          {songInfo && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handlePlayAudio}
              className="rounded-full w-10 h-10 bg-white/10 hover:bg-white/20 text-white"
            >
              <Play className="w-5 h-5 fill-white" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}