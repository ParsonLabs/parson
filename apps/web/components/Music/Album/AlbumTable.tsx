import { usePlayer } from "@/components/Music/Player/usePlayer";
import getBaseURL from '@/lib/Server/getBaseURL';
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { distance } from 'fastest-levenshtein';
import { useEffect, useState } from 'react';
import SongContextMenu from "../SongContextMenu";
import { getArtistInfo } from "@music/sdk";
import Link from "next/link";
import { useSession } from "@/components/Providers/AuthProvider";
import { Clock, Heart, MoreHorizontal, Music, Pause, Play, Plus } from "lucide-react";
import { cn } from "@music/ui/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@music/ui/components/badge";
import { Button } from "@music/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@music/ui/components/tooltip";
import Image from "next/image";

type AlbumTableProps = {
  songs: LibrarySong[]
  album: Album & { artist_object: Artist }
  artist: Artist
}

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

function isSimilarLevenshtein(apiTrack: string, userTrack: string): boolean {
  const normalizedApiTrack = normalizeString(apiTrack);
  const normalizedUserTrack = normalizeString(userTrack);
  const levenshteinDistance = distance(normalizedApiTrack, normalizedUserTrack);
  const maxLength = Math.max(normalizedApiTrack.length, normalizedUserTrack.length);
  const similarity = 1 - (levenshteinDistance / maxLength);
  return similarity > 0.6;
}

export default function AlbumTable({ songs, album, artist }: AlbumTableProps) {
  const { setImageSrc, setSong, setAudioSource, setArtist, setAlbum, addToQueue, song: currentSong, playAudioSource, setPlayedFromAlbum, isPlaying, togglePlayPause } = usePlayer();
  const [orderedSongs, setOrderedSongs] = useState<LibrarySong[]>([]);
  const [contributingArtists, setContributingArtists] = useState<{ [key: string]: Artist[] }>({});
  const [isHovered, setIsHovered] = useState<string | null>(null);
  const [likedSongs, setLikedSongs] = useState<Set<string>>(new Set());
  const [showTableHeader, setShowTableHeader] = useState(true);
  const [headerVisible, setHeaderVisible] = useState(false);

  let playingSongID = currentSong?.id || '';

  const { session } = useSession()
  const bitrate = session?.bitrate ?? 0;

  useEffect(() => {
    if (album.release_album) {
      const apiTracks = album.release_album.tracks.map(track => track.track_name);
      const userTracks = songs.map(song => song.name);

      const categorizedTracks = apiTracks.map(apiTrack => {
        const similarTracks = userTracks.filter(userTrack => isSimilarLevenshtein(apiTrack, userTrack));
        return {
          apiTrack,
          similarTracks
        };
      });

      const ordered: any[] = [];
      const remaining = [...songs];

      categorizedTracks.forEach(({ apiTrack, similarTracks }) => {
        similarTracks.forEach(similarTrack => {
          const song = songs.find(song => song.name === similarTrack);
          if (song) {
            ordered.push(song);
            const index = remaining.indexOf(song);
            if (index > -1) {
              remaining.splice(index, 1);
            }
          }
        });
      });

      setOrderedSongs([...ordered, ...remaining]);
    } else {
      setOrderedSongs(songs);
    }
  }, [songs, album]);

  useEffect(() => {
    const fetchContributingArtists = async () => {
      const artistMap: { [key: string]: Artist[] } = {};

      for (const song of songs) {
        if (song.contributing_artist_ids && song.contributing_artist_ids.length > 0) {
          const artistPromises = song.contributing_artist_ids.map(id => getArtistInfo(id));
          const artists = await Promise.all(artistPromises);
          artistMap[song.id] = artists;
        }
      }

      setContributingArtists(artistMap);
    };

    fetchContributingArtists();
  }, [songs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setHeaderVisible(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const handlePlay = async (song: LibrarySong) => {
    setImageSrc(`${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}`);
    setArtist(artist);
    setAlbum(album);
    setSong(song);
    setPlayedFromAlbum(true);
    
    setAudioSource(`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${bitrate}`);
    console.log(song.path)
    
    const currentIndex = orderedSongs.findIndex(s => s.id === song.id);
    if (currentIndex >= 0 && currentIndex < orderedSongs.length - 1) {
      const nextSong = orderedSongs[currentIndex + 1];
      if (nextSong) {
        const preloadLink = document.createElement('link');
        preloadLink.rel = 'prefetch';
        preloadLink.href = `${getBaseURL()}/api/stream/${encodeURIComponent(nextSong.path)}?bitrate=${bitrate}`;
        document.head.appendChild(preloadLink);
        setTimeout(() => document.head.removeChild(preloadLink), 5000);
      }
    }

    playAudioSource();
  };

  const handleToggleLike = (e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    setLikedSongs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  };

  const handleAddToQueue = (e: React.MouseEvent, song: LibrarySong) => {
    e.stopPropagation();
    addToQueue && addToQueue(song);
  };

  function formatDuration(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return (
    <div className="pb-16">
      {showTableHeader && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: headerVisible ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          className="grid grid-cols-[48px,4fr,1fr] md:grid-cols-[48px,4fr,2fr,1fr] items-center p-2 px-4 mb-2 text-xs uppercase tracking-wider text-gray-500 border-b border-white/5"
        >
          <div className="font-medium">#</div>
          <div className="font-medium">Title</div>
          <div className="font-medium hidden md:block">Artists</div>
          <div className="font-medium text-right">
            <Clock className="inline-block w-4 h-4" />
          </div>
        </motion.div>
      )}
      
      <div className="space-y-px">
        <AnimatePresence>
          {orderedSongs.map((song, index) => (
            <SongContextMenu
              song_name={song.name}
              song_id={song.id}
              artist_id={artist.id}
              artist_name={artist.name}
              album_id={album.id}
              album_name={album.name}
              key={song.id}
            >
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                className="song-row-wrapper rounded-lg overflow-hidden"
              >
                <div
                  onClick={() => {
                    handlePlay(song);
                  }}
                  onMouseEnter={() => setIsHovered(song.id)}
                  onMouseLeave={() => setIsHovered(null)}
                  className={cn(
                    "grid grid-cols-[48px,1fr,auto] md:grid-cols-[48px,4fr,2fr,1fr] items-center px-4 py-2.5 rounded-lg transition-all duration-200 group",
                    playingSongID === song.id 
                      ? "bg-white/20 backdrop-blur-md shadow-lg" 
                      : "hover:bg-white/10 backdrop-blur-sm cursor-pointer"
                  )}
                >
                  <div className="font-medium text-gray-200 relative w-10 flex items-center justify-center">
                    <div className={cn(
                      "w-8 h-8 flex items-center justify-center rounded-full transition-all",
                      playingSongID === song.id ? "bg-white/20" : "opacity-80"
                    )}>
                      {isHovered === song.id || playingSongID === song.id ? (
                        <button
                          className="flex items-center justify-center focus:outline-none"
                          onClick={(e) => {
                            handlePlay(song);
                          }}
                          aria-label={playingSongID === song.id && isPlaying ? "Pause" : "Play"}
                        >
                          {playingSongID === song.id && isPlaying ? (
                            <Pause className="w-5 h-5 text-white" fill="white" strokeWidth={0} />
                          ) : (
                            <Play className="w-5 h-5 text-white fill-white ml-0.5" fill="white" strokeWidth={0} />
                          )}
                        </button>
                      ) : (
                        <span className="opacity-70 group-hover:opacity-0 transition-opacity">
                          {song.track_number || index + 1}
                        </span>
                      )}
                    </div>
                    
                    {playingSongID === song.id && isPlaying && (
                      <div className="absolute -left-1 -top-1 flex gap-0.5 items-end">
                        <motion.div 
                          animate={{ height: ["4px", "12px", "4px"] }}
                          transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                          className="w-0.5 bg-white rounded-full"
                        ></motion.div>
                        <motion.div 
                          animate={{ height: ["4px", "16px", "4px"] }}
                          transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                          className="w-0.5 bg-white rounded-full"
                        ></motion.div>
                        <motion.div 
                          animate={{ height: ["4px", "8px", "4px"] }}
                          transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                          className="w-0.5 bg-white rounded-full"
                        ></motion.div>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 pl-2 pr-4">
                    <div className={cn(
                      "font-medium truncate",
                      playingSongID === song.id ? "text-white" : "text-gray-200"
                    )}>
                      {song.name}
                      
                      {!song.name && (
                        <Badge variant="outline" className="ml-2 py-0 px-1 text-xs bg-white/10">E</Badge>
                      )}
                    </div>
                  </div>

                  <div className="hidden md:block min-w-0 px-2 text-sm text-gray-400">
                    <div className="truncate">
                      <Link href={`/artist?id=${artist.id}`} 
                        onClick={(e) => e.stopPropagation()} 
                        className="hover:underline hover:text-white transition-colors">
                        {artist.name}
                      </Link>
                      {(contributingArtists[song.id]?.length ?? 0) > 0 && ', '}
                      {(contributingArtists[song.id] ?? []).map((contributingArtist, index) => (
                        <span key={contributingArtist.id}>
                          <Link href={`/artist?id=${contributingArtist.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-white transition-colors">
                            {contributingArtist.name}
                          </Link>
                          {index < (contributingArtists[song.id]?.length ?? 0) - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <div className={cn(
                      "flex items-center mr-4 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity",
                      isHovered === song.id ? "opacity-100" : ""
                    )}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            onClick={(e) => handleToggleLike(e, song.id)} 
                            className={cn(
                              "p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                              likedSongs.has(song.id) ? "text-pink-500 hover:text-pink-500" : ""
                            )}
                            aria-label={likedSongs.has(song.id) ? "Unlike" : "Like"}
                          >
                            <Heart className={cn("w-4 h-4", likedSongs.has(song.id) ? "fill-current" : "")} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {likedSongs.has(song.id) ? 'Remove from likes' : 'Add to likes'}
                        </TooltipContent>
                      </Tooltip>
                      
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            onClick={(e) => handleAddToQueue(e, song)} 
                            className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                            aria-label="Add to queue"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Add to queue</TooltipContent>
                      </Tooltip>
                    </div>
                    
                    <div className="text-right text-gray-400 text-sm font-medium w-12">
                      {formatDuration(song.duration)}
                    </div>
                  </div>
                </div>
              </motion.div>
            </SongContextMenu>
          ))}
        </AnimatePresence>
      </div>
      
      {orderedSongs.length === 0 && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-16 text-center"
        >
          <Music className="w-16 h-16 text-gray-500 mb-4 opacity-30" />
          <h3 className="text-xl font-medium text-gray-300 mb-2">No songs found</h3>
          <p className="text-gray-500 max-w-md">This album doesn&apos;t have any songs available in your library.</p>
        </motion.div>
      )}
    </div>
  );
}