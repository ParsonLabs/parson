"use client"

import { useSession } from "@/components/Providers/AuthProvider";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { useEffect, useState } from "react";
import { Clock, CalendarDays, Loader2, Music2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useGradientHover } from "@/components/Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";

interface HistoryItem extends LibrarySong {
  listened_at: string;
}

export default function HistoryPage() {
  const [listenHistorySongs, setListenHistorySongs] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setGradient } = useGradientHover();

  const { session } = useSession();

  useEffect(() => {
    setGradient("#121212");
    return () => setGradient("#000000");
  }, [setGradient]);

  useEffect(() => {
    const fetchListenHistory = async () => {
      if (!session) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        
        const listenHistoryItems = await getListenHistory(Number(session.sub));
        
        if (!listenHistoryItems || !listenHistoryItems.length) {
          setListenHistorySongs([]);
          setIsLoading(false);
          return;
        }
        
        const validSongs: HistoryItem[] = [];
        
        const sortedHistory = [...listenHistoryItems].reverse();
        
        for (const item of sortedHistory) {
          if (!item.song_id) continue;
          
          if (item.song_id.includes("youtube")) continue;
          
          try {
            const songInfo = await getSongInfo(item.song_id, false);
            if (songInfo && 'artist_object' in songInfo && 'album_object' in songInfo) {
              validSongs.push({
                ...songInfo as LibrarySong,
                listened_at: item.created_at || new Date().toISOString()
              });
            }
          } catch (songError) {
            console.warn(`Failed to fetch song info for ID ${item.song_id}:`, songError);
          }
        }
        
        setListenHistorySongs(validSongs);
      } catch (error) {
        console.error("Failed to fetch listen history:", error);
        setError("Failed to load listening history");
      } finally {
        setIsLoading(false);
      }
    };
  
    fetchListenHistory();
  }, [session]);

  const groupedByDate = listenHistorySongs.reduce((groups: Record<string, HistoryItem[]>, song) => {
    const date = new Date(song.listened_at).toLocaleDateString();
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(song);
    return groups;
  }, {});

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="px-6 md:px-8 py-8 max-w-6xl mx-auto">
      <header className="mb-8 pt-20">
        <div className="flex items-center gap-3 mb-2">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold">Listening History</h1>
        </div>
        <p className="text-zinc-400 text-sm">Your recently played tracks</p>
      </header>
      
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
          <p className="text-zinc-500">Loading your listening history...</p>
        </div>
      )}
      
      {error && (
        <div className="bg-red-900/20 border border-red-900/30 rounded-lg p-4 mb-6">
          <p className="text-red-400">{error}</p>
        </div>
      )}
      
      {!isLoading && !error && listenHistorySongs.length === 0 && (
        <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <Music2 className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
          <p className="text-zinc-400 text-xl mb-2">No listening history yet</p>
          <p className="text-zinc-500 text-sm max-w-md mx-auto">Start listening to music to build your history. Your recently played tracks will appear here.</p>
        </div>
      )}

      {!isLoading && listenHistorySongs.length > 0 && (
        <ScrollArea className="h-[calc(100vh-180px)]">
          <div className="pb-24 space-y-8">
            {Object.entries(groupedByDate).map(([date, songs]) => (
              <div key={date} className="rounded-lg overflow-hidden">
                <div className="bg-zinc-800/40 backdrop-blur-sm sticky top-0 px-4 py-3 flex items-center gap-2 z-10">
                  <CalendarDays className="h-4 w-4 text-zinc-400" />
                  <h2 className="text-sm font-medium text-zinc-300">{date}</h2>
                </div>
                
                <div className="divide-y divide-zinc-800/50">
                  {songs.map((song, index) => (
                    <div 
                      key={`${song.id}-${index}`}
                      className="flex items-center gap-3 p-2 hover:bg-white/5 transition-colors rounded-md group"
                    >
                      <div className="text-zinc-500 text-xs w-16 flex items-center justify-start">
                        <Clock className="h-3 w-3 mr-1 inline opacity-70" />
                        {formatTime(song.listened_at)}
                      </div>
      
                      <div className="relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden">
                        {song.album_object?.cover_url ? (
                          <Image 
                            src={`${getBaseURL()}/image/${encodeURIComponent(song.album_object.cover_url)}?raw=true`}
                            alt={song.album_object.name || "Album cover"}
                            width={48}
                            height={48}
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                            <Music2 className="h-5 w-5 text-zinc-600" />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <Link 
                          href={`/song/${song.id}`} 
                          className="text-white hover:underline font-medium block truncate"
                        >
                          {song.name}
                        </Link>
                        
                        <div className="flex items-center text-sm text-zinc-400">
                          {song.artist_object && (
                            <Link 
                              href={`/artist/${song.artist_object.id}`}
                              className="hover:underline hover:text-primary transition-colors truncate max-w-[200px]"
                            >
                              {song.artist_object.name}
                            </Link>
                          )}
                          
                          {song.album_object && (
                            <>
                              <span className="mx-1.5 text-zinc-600">•</span>
                              <Link 
                                href={`/album/${song.album_object.id}`}
                                className="hover:underline hover:text-primary transition-colors truncate max-w-[200px]"
                              >
                                {song.album_object.name}
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                      
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          className="w-8 h-8 flex items-center justify-center rounded-full bg-primary text-black hover:scale-105 transition-transform"
                          aria-label="Play song"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}    </div>
  );
}