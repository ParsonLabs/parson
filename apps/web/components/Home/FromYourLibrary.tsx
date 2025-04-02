"use client"

import { memo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import SongCard from "../Music/Card/SongCard";
import { useSession } from "../Providers/AuthProvider";
import ScrollButtons from "./ScrollButtons";

const MemoizedSongCard = memo(SongCard);

function shuffleArray<T>(array: T[]): T[] {
  const date = new Date();
  const seed = date.getDate() + date.getMonth() * 100;
  const shuffled = [...array];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(((i + 1) * Math.sin(seed + i)) * 1000) % (i + 1);
    if (i < shuffled.length && j < shuffled.length) {
      [shuffled[i] as any, shuffled[j] as any] = [shuffled[j], shuffled[i]];
    }
  }
  
  return shuffled;
}

async function getSongsFromYourLibrary(user_id: number, genre?: string) {
  try {
    const playlists = await getPlaylists(user_id);
    
    if (!playlists || playlists.length === 0) {
      return [];
    }
    
    const playlistSongIDsPromises = playlists.map(async (playlist) => {
      try {
        const individualPlaylist = await getPlaylist(playlist.id);
        return individualPlaylist.song_infos.map((songInfo) => songInfo.song_id);
      } catch (err) {
        return [];
      }
    });

    const playlistSongIDsArrays = await Promise.all(playlistSongIDsPromises);
    const playlistSongIDs = playlistSongIDsArrays.flat();
    
    if (playlistSongIDs.length === 0) {
      return [];
    }

    const songsDetailsPromises = playlistSongIDs.map((songID) => 
      getSongInfo(String(songID)).catch(() => null)
    );
    
    const songsDetails = (await Promise.all(songsDetailsPromises)).filter(Boolean) as LibrarySong[];

    const filteredSongs = genre 
      ? songsDetails.filter(song => {
          const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
          const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
          return releaseAlbumGenres || releaseGroupAlbumGenres;
        })
      : songsDetails;
    
    return shuffleArray(filteredSongs);
  } catch (err) {
    return [];
  }
}

interface FromYourLibraryProps {
  genre?: string;
}

export default function FromYourLibrary({ genre }: FromYourLibraryProps) {
  const { session } = useSession();
  const [processedSongs, setProcessedSongs] = useState<LibrarySong[]>([]);

  const { data: librarySongs = [], isLoading } = useQuery({
    queryKey: ['fromYourLibrary', session?.sub, genre],
    queryFn: () => getSongsFromYourLibrary(Number(session?.sub), genre),
    staleTime: 60 * 60 * 1000,
    enabled: !!session?.sub
  });

  useEffect(() => {
    if (!librarySongs || librarySongs.length === 0) return;

    const processData = async () => {
      const cleanedSongs = librarySongs.filter(song => song !== undefined);
      
      const processedSongsPromises = cleanedSongs.map(async (song) => {
        if (!song) return null;
        
        if (!song.album_object || !song.artist_object) {
          try {
            return await getSongInfo(song.id, false);
          } catch {
            return song;
          }
        }
        
        return song;
      });

      const results = await Promise.all(processedSongsPromises);
      const validResults = results.filter(Boolean) as LibrarySong[];
      
      setProcessedSongs(validResults);
    };

    processData();
  }, [librarySongs]);

  if (isLoading) return (
    <ScrollButtons heading="From Your Library" id="FromYourLibrary">
      <div className="flex flex-row pb-14 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div className="mr-20" key={i}>
            <div className="w-40 h-40 bg-gray-800 rounded-md"></div>
            <div className="w-32 h-4 mt-2 bg-gray-800 rounded"></div>
            <div className="w-24 h-3 mt-1 bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>
    </ScrollButtons>
  );

  if (!librarySongs || librarySongs.length === 0) {
    return (
      <ScrollButtons heading="From Your Library" id="FromYourLibrary">
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <p>No songs found in your library</p>
        </div>
      </ScrollButtons>
    );
  }

  return (
    <ScrollButtons heading="From Your Library" id="FromYourLibrary">
      <div className="flex flex-row pb-14">
        {processedSongs.length > 0 ? (
          processedSongs.map((song) => (
            <div className="mr-20" key={`${song.id}-${song.album_object?.id || 'unknown'}`}>
              <MemoizedSongCard 
                album_cover={song.album_object?.cover_url || ''} 
                album_id={String(song.album_object?.id || 0)} 
                album_name={song.album_object?.name || 'Unknown Album'} 
                artist_id={String(song.artist_object?.id || 0)} 
                artist_name={song.artist || 'Unknown Artist'} 
                path={song.path || ''} 
                song_id={song.id} 
                song_name={song.name || 'Unknown Song'} 
              />
            </div>
          ))
        ) : (
          <div className="flex items-center justify-center w-full py-10 text-gray-400">
            <p>Processing your library...</p>
          </div>
        )}
      </div>
    </ScrollButtons>
  );
}