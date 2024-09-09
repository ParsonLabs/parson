"use client"

import getBaseURL from "@/lib/Server/getBaseURL";
import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import BigCard from "../Music/Card/BigCard";
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

  const songsDetails = await Promise.all(songsDetailsPromises);

  if (genre) {
    return songsDetails.filter(song => {
      const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
      const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
      return releaseAlbumGenres || releaseGroupAlbumGenres;
    });
  }

  return songsDetails;
}

interface FromYourLibraryProps {
  genre?: string;
}

export default function FromYourLibrary({ genre }: FromYourLibraryProps) {
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const session = getSession();
  
    async function fetchSongs() {
      const cacheKey = "fromYourLibrary";
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
  }, [genre]);

  if (loading) return null;
  if (!librarySongs || librarySongs.length === 0) return null;

  return (
    <ScrollButtons heading="From Your Library">
      <div className="flex flex-row">
        {librarySongs.map((song, index) => (
          <div className="mr-20" key={index}>
            <BigCard
              title={song.name}
              album={song.album_object}
              artist={song.artist_object}
              imageSrc={
                song.album_object.cover_url.length === 0
                  ? "/snf.png"
                  : `${getBaseURL()}/image/${encodeURIComponent(song.album_object.cover_url)}`
              }
              albumURL=""
              songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=0`}
              type="Song"
              song={song}
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}