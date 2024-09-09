"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback } from "@music/ui/components/avatar";
import FollowButton from "@/components/Friends/FollowButton";
import { getCookie } from "cookies-next";
import { getListenHistory, getUserInfo, getSongInfo, getAlbumInfo, LibraryAlbum } from "@music/sdk";
import { useRouter } from "next/router";
import getSession, { ExtendedJWTPayload } from "@/lib/Authentication/JWT/getSession";
import { useSearchParams } from "next/navigation";
import { Artist, LibrarySong } from "@music/sdk/types";
import ScrollButtons from "@/components/Home/ScrollButtons";
import BigCard from "@/components/Music/Card/BigCard";
import getBaseURL from "@/lib/Server/getBaseURL";
import AlbumCard from "@/components/Music/Card/Album/AlbumCard";
import ArtistCard from "@/components/Music/Artist/ArtistCard";
import setCache, { getCache } from "@/lib/Caching/cache";

export default function UsernameComponent() {
  const searchParams = useSearchParams();
  const username = searchParams?.get("username");

  const [user, setUser] = useState<any>(null);
  const [topArtists, setTopArtists] = useState<(Artist & { count: number })[]>([]);
  const [topAlbums, setTopAlbums] = useState<(LibraryAlbum & { count: number, artist: Artist })[]>([]);
  const [topSongs, setTopSongs] = useState<(LibrarySong & { count: number })[]>([]);

  const session = getSession();
  useEffect(() => {
    async function fetchData() {
      const userCacheKey = `userInfo_${username}`;
      const listenHistoryCacheKey = `listenHistory_${username}`;
      const songInfoCacheKey = `songInfo_${username}`;
  
      let userInfo = getCache(userCacheKey);
      if (!userInfo) {
        userInfo = await getUserInfo(username as string);
        setCache(userCacheKey, userInfo, 3600000);
      }
      setUser(userInfo);
  
      let listenHistory = getCache(listenHistoryCacheKey);
      if (!listenHistory) {
        listenHistory = await getListenHistory(userInfo.id);
        setCache(listenHistoryCacheKey, listenHistory, 3600000);
      }
  
      const songInfoPromises = listenHistory.map(async (history: { song_id: string; }) => {
        const songCacheKey = `${songInfoCacheKey}_${history.song_id}`;
        let songInfo = getCache(songCacheKey);
        if (!songInfo) {
          songInfo = await getSongInfo(history.song_id);
          setCache(songCacheKey, songInfo, 3600000);
        }
        return songInfo;
      });
      const songsInfo = await Promise.all(songInfoPromises);
  
      const artistFrequency: Record<string, { count: number; info: Artist }> = songsInfo.reduce((acc, song) => {
        const artistId = song.artist_object.id;
        if (!acc[artistId]) {
          acc[artistId] = { count: 0, info: song.artist_object };
        }
        acc[artistId].count++;
        return acc;
      }, {});
      
      const albumFrequency: Record<string, { count: number; info: LibraryAlbum; artist: Artist }> = songsInfo.reduce((acc, song) => {
        const albumId = song.album_object.id;
        if (!acc[albumId]) {
          acc[albumId] = { count: 0, info: song.album_object, artist: song.artist_object };
        }
        acc[albumId].count++;
        return acc;
      }, {});
      
      const songFrequency: Record<string, { count: number; info: LibrarySong }> = songsInfo.reduce((acc, song) => {
        const songId = song.id;
        if (!acc[songId]) {
          acc[songId] = { count: 0, info: song };
        }
        acc[songId].count++;
        return acc;
      }, {});
      
  
      const sortedArtists = Object.values(artistFrequency)
        .sort((a, b) => b.count - a.count)
        .map((artist) => ({ ...artist.info, count: artist.count }));
  
      const sortedAlbums = Object.values(albumFrequency)
        .sort((a, b) => b.count - a.count)
        .map((album) => ({ ...album.info, artist: album.artist, count: album.count }));
  
      const sortedSongs = Object.values(songFrequency)
        .sort((a, b) => b.count - a.count)
        .map((song) => ({ ...song.info, count: song.count }));
  
      setTopArtists(sortedArtists);
      setTopAlbums(sortedAlbums);
      setTopSongs(sortedSongs);
    }
  
    if (username) {
      fetchData();
    }
  }, [username]);

  if (!user) {
    return null;
  }

  return (
    <div className="text-center min-h-screen">
      <div className="flex items-center space-x-4 pt-32 justify-center">
        {user.image ? (
          <Image src={user.image} alt="" className="w-32 h-32 rounded-full" />
        ) : (
          <Avatar className="w-32 h-32">
            <AvatarFallback className="text-4xl">
              {user.username.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex flex-col">
          <p className="text-lg">@{user.username}</p>
          {user.username !== session?.username && (
            <FollowButton userIDToFollow={user.id} />
          )}
        </div>
      </div>

      <ScrollButtons heading="Top Artists">
        <div className="flex flex-row">
          {topArtists.map((artist, index) => (
            <div className="mr-20" key={index}>
              <ArtistCard artist={artist} />
            </div>
          ))}
        </div>
      </ScrollButtons>

      <ScrollButtons heading="Top Albums">
        <div className="flex flex-row">
          {topAlbums.map((album, index) => (
            <div className="mr-20" key={index}>
              <AlbumCard 
                album={album}
                artist={album.artist}
                key={album.id}
              />
            </div>
          ))}
        </div>
      </ScrollButtons>

      <ScrollButtons heading="Top Songs">
        <div className="flex flex-row">
          {topSongs.map((song, index) => (
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
                songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${(session && session.bitrate) ?? 0}`}
                type="Song"
                song={song}
              />
            </div>
          ))}
        </div>
      </ScrollButtons>
    </div>
  );
}