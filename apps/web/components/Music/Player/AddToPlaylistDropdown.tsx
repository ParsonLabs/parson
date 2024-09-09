"use client"


import CheckCircle from "@/components/Icons/CheckCircle"
import getSession from "@/lib/Authentication/JWT/getSession"
import { addSongToPlaylist, getPlaylist, getPlaylists, getSongInfo } from "@music/sdk"
import { Playlist as BasePlaylist, LibrarySong } from "@music/sdk/types"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@music/ui/components/dropdown-menu"
import { ScrollArea } from "@music/ui/components/scroll-area"
import { CircleDashed } from "lucide-react"
import { useEffect, useState } from "react"
import { usePlayer } from "./usePlayer"

type AddToPlaylistDropdownProps = {
  children: React.ReactNode;
};

type SongInfo = {
  song_id: string;
  date_added: string;
};

type PlaylistWithSongs = BasePlaylist & {
  songs: (LibrarySong & { date_added: string })[];
  song_infos: SongInfo[];
  user_ids: number[];
};

export default function AddToPlaylistDropdown({ children }: AddToPlaylistDropdownProps) {
  const { song, isPlaying } = usePlayer();
  
  const [playlists, setPlaylists] = useState<PlaylistWithSongs[]>([]);
  const [playlistAddedNow, setPlaylistAddedNow] = useState("");

  useEffect(() => {
    const getPlaylistsRequest = async () => {
      const sessionData = getSession();
      if (sessionData) {
        const playlistsResponse = await getPlaylists(Number(sessionData.sub));
        const detailedPlaylistsPromises = playlistsResponse.map(playlist => getPlaylist(playlist.id));
        const detailedPlaylists = await Promise.all(detailedPlaylistsPromises);
    
        const songsDetailsPromises = detailedPlaylists.flatMap(playlist => 
          playlist.song_infos.map(songInfo => getSongInfo(String(songInfo.song_id)).then(songDetails => ({
            ...songDetails,
            date_added: songInfo.date_added
          })))
        );

        const songsDetails = await Promise.all(songsDetailsPromises);
        
        const playlistsWithSongs = detailedPlaylists.map((playlist, index: number) => ({
          ...playlist,
          createdAt: new Date(playlist.created_at),
          updatedAt: new Date(playlist.updated_at),
          songs: songsDetails.slice(index * playlist.song_infos.length, (index + 1) * playlist.song_infos.length) as (LibrarySong & { date_added: string })[],
        }));
      
        setPlaylists(playlistsWithSongs as PlaylistWithSongs[]);
      }
    };
  
    if (isPlaying) {
      getPlaylistsRequest();
    }
  }, [isPlaying]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        {children}
      </DropdownMenuTrigger>

      <DropdownMenuContent>
        <DropdownMenuLabel>Add to Playlist</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea>
          {playlists && playlists.map((playlist) => (
            <DropdownMenuItem key={playlist.id} onClick={() => {
              addSongToPlaylist(playlist.id, song.id)
              setPlaylistAddedNow(String(playlist.id))
            }}>
              {playlist.name}
              <DropdownMenuShortcut>
                {/* Converting to Strings due to JS' precision limits for numbers. Numbers between -(2^53 - 1) and 2^53 - 1; Any number outside this range can lose precision. The Song ID's are larger than 2^53 -1 (9e15)*/}
                {playlist.songs.some(playlistSong => String(playlistSong.id) === String(song.id)) || String(playlist.id) === playlistAddedNow ? <CheckCircle className="m-4"/> : <CircleDashed />}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          ))}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}