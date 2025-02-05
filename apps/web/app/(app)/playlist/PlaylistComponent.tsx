"use client"

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePlayer } from '@/components/Music/Player/usePlayer';
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { Avatar, AvatarFallback } from "@music/ui/components/avatar";
import { cn } from '@music/ui/lib/utils';
import { Play, Pause } from 'lucide-react';
import { getPlaylist, getSongInfo, getUserInfoById } from "@music/sdk";
import { Album, Artist, LibrarySong, Playlist as OriginalPlaylist } from "@music/sdk/types";
import DeletePlaylistButton from "@/components/Music/Playlist/DeletePlaylistButton";
import PlaylistCard from '@/components/Music/Playlist/PlaylistCard';
import SongContextMenu from '@/components/Music/SongContextMenu';
import getBaseURL from '@/lib/Server/getBaseURL';

interface Playlist extends OriginalPlaylist {
  users: { id: number; username: string }[];
  createdAt: Date;
  updatedAt: Date;
}

type LibrarySongWithDate = LibrarySong & { date_added: string }

export default function PlaylistComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");
  const { song: currentSong, isPlaying, setImageSrc, setSong, setAudioSource, setArtist, setAlbum } = usePlayer();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songsWithMetadata, setSongsWithMetadata] = useState<LibrarySongWithDate[]>([]);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [isHovered, setIsHovered] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlaylistData() {
      if (!id) return;
      
      const playlistData = await getPlaylist(Number(id));
      const users = await Promise.all(
        playlistData.user_ids.map(async (userId: number) => {
          const userInfo = await getUserInfoById(userId);
          return { id: userInfo.id, username: userInfo.username };
        })
      );

      setPlaylist({ 
        ...playlistData, 
        users, 
        createdAt: new Date(playlistData.created_at), 
        updatedAt: new Date(playlistData.updated_at) 
      });

      const songsWithMetadataPromises = playlistData.song_infos.map(async (songInfo: { song_id: string, date_added: string }) => {
        const songData = await getSongInfo(songInfo.song_id);
        return { ...songData, date_added: songInfo.date_added };
      });

      const songsWithMetadataData = await Promise.all(songsWithMetadataPromises);
      setSongsWithMetadata(songsWithMetadataData as LibrarySongWithDate[]);

      const totalDuration = songsWithMetadataData.reduce((total, song) => total + song.duration, 0);
      setTotalDuration(totalDuration);
    }

    fetchPlaylistData();
  }, [id]);

  function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.round(duration % 60);

    let result = '';
    if (hours > 0) result += `${hours} Hour${hours > 1 ? 's' : ''} `;
    if (minutes > 0) result += `${minutes} Minute${minutes > 1 ? 's' : ''} `;
    if (seconds > 0) result += `${seconds} Second${seconds > 1 ? 's' : ''}`;
    return result.trim();
  }

  function handlePlay(coverUrl: string, song: LibrarySong, streamUrl: string, artist: Artist, album: Album) {
    setImageSrc(coverUrl);
    setSong(song);
    setAudioSource(streamUrl);
    setArtist(artist);
    setAlbum(album);
  }

  if (!playlist) return null;

  const sortedSongs = [...songsWithMetadata].sort((a, b) => 
    new Date(a.date_added).getTime() - new Date(b.date_added).getTime()
  );

  return (
    <ScrollArea className="h-full overflow-x-hidden overflow-y-auto">
      <div className="relative min-h-[300px] px-8 pt-24 pb-8">
        <div 
          className="absolute inset-0 bg-gradient-to-b from-neutral-800/30 to-background"
          style={{ zIndex: -1 }}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-[auto,1fr,auto] gap-8 items-start">
          <div className="flex justify-center">
            <Avatar className="w-48 h-48 rounded-lg shadow-2xl">
              <AvatarFallback className="text-6xl bg-gradient-to-br from-neutral-700 to-neutral-900">
                {playlist.users[0]?.username?.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-400">Playlist</p>
              <h1 className="text-5xl font-bold mt-2 text-white">{playlist.name}</h1>
            </div>

            <div className="flex items-center gap-4 text-sm text-neutral-400">
              {playlist.users.map((user) => (
                <div key={user.id} className="flex items-center gap-2">
                  <Avatar className="w-6 h-6">
                    <AvatarFallback>{user.username[0]}</AvatarFallback>
                  </Avatar>
                  <span>{user.username}</span>
                </div>
              ))}
              <span>•</span>
              <span>{formatDuration(totalDuration)}</span>
            </div>
          </div>

          <div className="flex items-start gap-2">
            {id && <DeletePlaylistButton playlistID={id} />}
          </div>
        </div>
      </div>

      <div className="px-8">
        <div className="flex flex-col space-y-1 pb-24">
          {sortedSongs.map((song, index) => (
            <SongContextMenu
              key={song.id}
              song_name={song.name}
              song_id={song.id}
              artist_id={song.artist_object.id}
              artist_name={song.artist_object.name}
              album_id={song.album_object.id}
              album_name={song.album_object.name}
            >
              <div
                onMouseEnter={() => setIsHovered(song.id)}
                onMouseLeave={() => setIsHovered(null)}
                onClick={() => handlePlay(
                  song.album_object.cover_url,
                  song,
                  `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}`,
                  song.artist_object,
                  song.album_object
                )}
                className={cn(
                  "grid grid-cols-[48px,1fr,auto] items-center p-2 rounded-lg transition-all duration-200 hover:bg-white/10 backdrop-blur-sm cursor-pointer group",
                  currentSong.id === song.id ? "bg-white/20" : ""
                )}
              >
                <div className="font-medium text-gray-200 relative w-12 flex items-center justify-center">
                  {isHovered === song.id || currentSong.id === song.id ? (
                    <div className="flex items-center justify-center">
                      {currentSong.id === song.id && isPlaying ? (
                        <Pause className="w-5 h-5 text-white" fill="white" strokeWidth={0} />
                      ) : (
                        <Play className="w-5 h-5 text-white" fill="white" strokeWidth={0} />
                      )}
                    </div>
                  ) : (
                    <span className="opacity-50 group-hover:opacity-0">{index + 1}</span>
                  )}
                </div>

                <div className="min-w-0">
                  <PlaylistCard
                    song={song}
                    coverURL={song.album_object.cover_url}
                    artist={song.artist_object}
                    album={song.album_object}
                    showCover={true}
                    showArtist={true}
                  />
                </div>

                <div className="text-right text-gray-400 text-sm px-4">
                  {formatDuration(song.duration)}
                </div>
              </div>
            </SongContextMenu>
          ))}
        </div>
      </div>
      <ScrollBar />
    </ScrollArea>
  );
}