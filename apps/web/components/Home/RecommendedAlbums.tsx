"use client"

import setCache, { getCache } from "@/lib/Caching/cache";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import { useSession } from "../Providers/AuthProvider";
import ScrollButtons from "./ScrollButtons";

async function getSongsFromYourLibrary(user_id: number, genre?: string) {
  const playlists = await getPlaylists(user_id);

  const playlistSongIDsPromises = playlists.map(async (playlist) => {
    const individualPlaylist = await getPlaylist(playlist.id);
    return individualPlaylist.song_infos.map((songInfo) => songInfo.song_id);
  });

  const playlistSongIDsArrays = await Promise.all(playlistSongIDsPromises);
  const playlistSongIDs = playlistSongIDsArrays.flat();

  const songsDetailsPromises = playlistSongIDs.map((songID) => getSongInfo(String(songID)));

  const songsDetails = await Promise.all(songsDetailsPromises) as unknown as LibrarySong[];

  if (genre) {
    return songsDetails.filter(song => {
      const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
      const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
      return releaseAlbumGenres || releaseGroupAlbumGenres;
    });
  }

  return songsDetails;
}

interface RecommendedAlbumsProps {
  genre?: string;
}

export default function RecommendedAlbums({ genre }: RecommendedAlbumsProps) {
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useSession()
  
  useEffect(() => {
  
    async function fetchSongs() {
      const cacheKey = genre ? `recommendedAlbums_${genre}` : "recommendedAlbums";
      const cachedData = genre ? null : getCache(cacheKey);
  
      if (cachedData) {
        setLibrarySongs(cachedData);
        setLoading(false);
      } else {
        if (session) {
          const songs = await getSongsFromYourLibrary(Number(session.sub), genre);
          setLibrarySongs(songs);
          setLoading(false);
          if (!genre) {
            setCache(cacheKey, songs, 3600000);
          }
        }
      }
    }
  
    fetchSongs();
  }, [genre, session]);

  if (loading) return null;
  if (!librarySongs || librarySongs.length === 0) return null;

  return (
    <ScrollButtons heading="Recommended Albums" id="RecommendedAlbums">
      <div className="flex flex-row pb-14">
        {librarySongs.map((song, index) => (
          <div className="mr-20" key={index}>
            <AlbumCard 
              album_cover={song.album_object.cover_url}
              album_id={song.album_object.id}
              album_name={song.album_object.name}
              album_songs_count={song.album_object.songs.length}
              artist_id={song.artist_object.id}
              artist_name={song.artist}
              first_release_date={song.album_object.first_release_date}
              key={song.id}
              />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}