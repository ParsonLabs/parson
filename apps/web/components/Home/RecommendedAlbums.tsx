"use client"

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import { useSession } from "../Providers/AuthProvider";
import ScrollButtons from "./ScrollButtons";

const MemoizedAlbumCard = memo(AlbumCard);

function shuffleWithSeed<T>(array: T[]): T[] {
  const seed = new Date().getDate();
  const shuffled = [...array];
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(((i + 1) * Math.sin(seed + i)) * 1000) % (i + 1);
    [shuffled[i] as any, shuffled[j] as any] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, 20);
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

  const uniqueAlbums = Array.from(
    new Map(
      songsDetails.map(song => [song.album_object.id, song])
    ).values()
  );

  const filteredAlbums = genre 
    ? uniqueAlbums.filter(song => {
        const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
        const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
        return releaseAlbumGenres || releaseGroupAlbumGenres;
      })
    : uniqueAlbums;

  return shuffleWithSeed(filteredAlbums);
}

interface RecommendedAlbumsProps {
  genre?: string;
}

export default function RecommendedAlbums({ genre }: RecommendedAlbumsProps) {
  const { session } = useSession();

  const { data: librarySongs = [], isLoading } = useQuery({
    queryKey: ['recommendedAlbums', session?.sub, genre],
    queryFn: () => getSongsFromYourLibrary(Number(session?.sub), genre),
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.sub
  });

  if (isLoading) return null;
  if (!librarySongs || librarySongs.length === 0) return null;

  const validSongs = librarySongs.filter((song): song is LibrarySong => 
    !!song && 
    !!song.album_object &&
    !!song.album_object.id &&
    !!song.artist_object &&
    !!song.artist_object.id
  );

  return (
    <ScrollButtons heading="Recommended Albums" id="RecommendedAlbums">
      <div className="flex flex-row pb-16">
        {validSongs.map((song) => (
          <div className="mr-20" key={`${song.album_object.id}-${song.id}`}>
            <MemoizedAlbumCard 
              album_cover={song.album_object.cover_url ?? ''}
              album_id={song.album_object.id}
              album_name={song.album_object.name ?? 'Unknown Album'}
              album_songs_count={song.album_object.songs?.length ?? 0}
              artist_id={song.artist_object.id}
              artist_name={song.artist ?? 'Unknown Artist'}
              first_release_date={song.album_object.first_release_date ?? ''}
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}