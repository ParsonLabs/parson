import { useQuery } from "@tanstack/react-query";
import { getPlaylist, getSongInfo } from "@music/sdk";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import getBaseURL from "@/lib/Server/getBaseURL";
import { cn } from "@music/ui/lib/utils";

interface PlaylistCoverGridProps {
  playlistId: number;
  size?: number | string;
  className?: string;
}

export default function PlaylistCoverGrid({ 
  playlistId, 
  size = "100%", 
  className = "" 
}: PlaylistCoverGridProps) {
  const { data: playlist, isLoading: isPlaylistLoading } = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: () => getPlaylist(playlistId),
  });

  const songIds = playlist?.song_infos?.slice(0, 4).map(info => info.song_id) || [];
  
  const { data: songs, isLoading: isSongsLoading } = useQuery({
    queryKey: ['playlistGridSongs', playlistId, songIds],
    queryFn: async () => {
      if (songIds.length === 0) return [];
      return Promise.all(songIds.map(id => getSongInfo(id, false)));
    },
    enabled: songIds.length > 0,
  });

  const isLoading = isPlaylistLoading || isSongsLoading;

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center w-full h-full", className)}>
        <Loader2 className="w-5 h-5 animate-spin text-white/70" />
      </div>
    );
  }

  if (!songs || songs.length === 0) {
    return (
      <div className={cn("w-full h-full bg-neutral-800 flex items-center justify-center", className)}>
        <div className="text-neutral-600 text-3xl font-bold">?</div>
      </div>
    );
  }

  const gridClass = cn(
    "w-full h-full overflow-hidden",
    songs.length === 1 ? "grid-cols-1 grid-rows-1" :
    songs.length === 2 ? "grid-cols-2 grid-rows-1" :
    songs.length === 3 ? "grid-cols-2 grid-rows-2" : 
    "grid-cols-2 grid-rows-2",
    className
  );

  return (
    <div 
      className={cn("grid", gridClass)}
      style={{ 
        width: typeof size === 'number' ? `${size}px` : size,
        height: typeof size === 'number' ? `${size}px` : size
      }}
    >
      {[...Array(4)].map((_, index) => {
        const song = songs[index];
        if (!song) {
          return (
            <div 
              key={`empty-${index}`} 
              className="bg-gradient-to-br from-neutral-800 to-neutral-900 w-full h-full"
            />
          );
        }
        
        const coverUrl = 'album_object' in song && song.album_object.cover_url?.length === 0
          ? "/snf.png"
          : `${getBaseURL()}/image/${encodeURIComponent('album_object' in song ? song.album_object.cover_url : '')}`;
          
        return (
          <div key={song.id} className="relative w-full h-full">
            <Image
              src={coverUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100px, 200px"
              priority={index < 2}
              className="object-cover"
            />
          </div>
        );
      })}
    </div>
  );
}