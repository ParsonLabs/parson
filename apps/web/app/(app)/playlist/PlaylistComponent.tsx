"use client"

import React, { useState, useEffect } from 'react';
import PlaylistTable from "@/components/Music/Playlist/PlaylistTable";
import { Avatar, AvatarFallback } from "@music/ui/components/avatar";
import DeletePlaylistButton from "@/components/Music/Playlist/DeletePlaylistButton";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { getPlaylist, getSongInfo, getUserInfoById } from "@music/sdk";
import { useSearchParams } from 'next/navigation';
import { Album, Artist, LibrarySong, Playlist as OriginalPlaylist } from "@music/sdk/types";

interface Playlist extends OriginalPlaylist {
  users: { id: number; username: string }[];
  createdAt: Date;
  updatedAt: Date;
}

export default function PlaylistComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songsWithMetadata, setSongsWithMetadata] = useState<(LibrarySong & { date_added: string })[]>([]);
  const [totalDuration, setTotalDuration] = useState<number>(0);

  useEffect(() => {
    async function fetchPlaylistData() {
      if (id) {
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
        setSongsWithMetadata(songsWithMetadataData);

        const totalDuration = songsWithMetadataData.reduce((total: number, song: LibrarySong & { date_added: string }) => total + song.duration, 0);
        setTotalDuration(totalDuration);
      }
    }

    fetchPlaylistData();
  }, [id]);

  function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.round(duration % 60);

    let result = '';
    if (hours > 0) {
      result += `${hours} Hour${hours > 1 ? 's' : ''} `;
    }
    if (minutes > 0) {
      result += `${minutes} Minute${minutes > 1 ? 's' : ''} `;
    }
    if (seconds > 0) {
      result += `${seconds} Second${seconds > 1 ? 's' : ''}`;
    }
    return result.trim();
  }

  if (!playlist) return null


  return (
    <ScrollArea className="h-full overflow-x-hidden overflow-y-auto pt-20">
      <div className="flex flex-row items-start justify-between space-x-5 m-10">
        <div className="flex items-center justify-center space-x-5 flex-grow">
          <div>
            <Avatar className="w-24 h-24 text-4xl">
              <AvatarFallback>{playlist.users[0]?.username?.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </div>
          <div className="text-center">
            <h1 className="text-3xl">{playlist.name}</h1>
            {playlist.users.map((user) => {
              return <h1 key={user.id} className="text-2xl">Created by {user.username}</h1>;
            })}
            {formatDuration(totalDuration)}
          </div>
        </div>
        <div className="flex items-start">
          <DeletePlaylistButton playlistID={id ?? ""} />
        </div>
      </div>
      <PlaylistTable songsWithMetadata={songsWithMetadata} />
      <ScrollBar />
    </ScrollArea>
  );
}