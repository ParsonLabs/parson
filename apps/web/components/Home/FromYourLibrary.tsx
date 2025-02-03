"use client"

import { memo } from "react";
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
  const playlists = await getPlaylists(user_id);
  const playlistSongIDsPromises = playlists.map(async (playlist) => {
    const individualPlaylist = await getPlaylist(playlist.id);
    return individualPlaylist.song_infos.map((songInfo) => songInfo.song_id);
  });

  const playlistSongIDsArrays = await Promise.all(playlistSongIDsPromises);
  const playlistSongIDs = playlistSongIDsArrays.flat();
  const songsDetailsPromises = playlistSongIDs.map((songID) => getSongInfo(String(songID)));
  const songsDetails = await Promise.all(songsDetailsPromises) as LibrarySong[];

  const filteredSongs = genre 
    ? songsDetails.filter(song => {
        const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
        const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
        return releaseAlbumGenres || releaseGroupAlbumGenres;
      })
    : songsDetails;

  return shuffleArray(filteredSongs);
}

interface FromYourLibraryProps {
  genre?: string;
}

export default function FromYourLibrary({ genre }: FromYourLibraryProps) {
  const { session } = useSession();

  const { data: librarySongs = [], isLoading } = useQuery({
    queryKey: ['fromYourLibrary', session?.sub, genre],
    queryFn: () => getSongsFromYourLibrary(Number(session?.sub), genre),
    staleTime: 60 * 60 * 1000,
    enabled: !!session?.sub
  });

  if (isLoading) return null;
  if (!librarySongs || librarySongs.length === 0) return null;

  return (
    <ScrollButtons heading="From Your Library" id="FromYourLibrary">
      <div className="flex flex-row pb-14">
        {librarySongs.map((song) => (
          <div className="mr-20" key={`${song.id}-${song.album_object.id}`}>
            <MemoizedSongCard 
              album_cover={song.album_object.cover_url} 
              album_id={song.album_object.id} 
              album_name={song.album_object.name} 
              artist_id={song.artist_object.id} 
              artist_name={song.artist} 
              path={song.path} 
              song_id={song.id} 
              song_name={song.name} 
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}