"use client";

import FollowButton from "@/components/Friends/FollowButton";
import ScrollButtons from "@/components/Home/ScrollButtons";
import PageGradient from "@/components/Layout/PageGradient";
import ArtistCard from "@/components/Music/Artist/ArtistCard";
import AlbumCard from "@/components/Music/Card/Album/AlbumCard";
import SongCard from "@/components/Music/Card/SongCard";
import getSession from "@/lib/Authentication/JWT/getSession";
import { getCache } from "@/lib/Caching/cache";
import { getListenHistory, getProfilePicture, getSongInfo, getUserInfo, LibraryAlbum } from "@music/sdk";
import { Artist, LibrarySong } from "@music/sdk/types";
import { Avatar, AvatarFallback, AvatarImage } from "@music/ui/components/avatar";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function UsernameComponent() {
  const searchParams = useSearchParams();
  const username = searchParams?.get("username");

  const [user, setUser] = useState<any>(null);
  const [topArtists, setTopArtists] = useState<(Artist & { count: number })[]>([]);
  const [topAlbums, setTopAlbums] = useState<(LibraryAlbum & { count: number, artist: Artist })[]>([]);
  const [topSongs, setTopSongs] = useState<(LibrarySong & { count: number })[]>([]);
  const [profilePicture, setProfilePicture] = useState<string | null>(null);

  const session = getSession();
  useEffect(() => {
    async function fetchData() {
      const userCacheKey = `userInfo_${username}`;
      const listenHistoryCacheKey = `listenHistory_${username}`;
      const songInfoCacheKey = `songInfo_${username}`;

      let userInfo = getCache(userCacheKey);
      if (!userInfo) {
        userInfo = await getUserInfo(username as string);
      }
      setUser(userInfo);

      let listenHistory = getCache(listenHistoryCacheKey);
      if (!listenHistory) {
        listenHistory = await getListenHistory(userInfo.id);
      }

      const songInfoPromises = listenHistory.map(async (history: { song_id: string; }) => {
        const songCacheKey = `${songInfoCacheKey}_${history.song_id}`;
        let songInfo = getCache(songCacheKey);
        if (!songInfo) {
          songInfo = await getSongInfo(history.song_id);
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

      const profilePic = await getProfilePicture(userInfo.id);
      if (profilePic) {
        setProfilePicture(URL.createObjectURL(profilePic));
      } else {
        setProfilePicture(null);
      }
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
      <PageGradient imageSrc={profilePicture ?? ""} />
      <div className="flex items-center space-x-4 pt-32 justify-center">
        {profilePicture ? (
          <Avatar className="w-32 h-32">
            <AvatarImage src={profilePicture} alt="User Profile Picture" className="bg-gray-600" />
          </Avatar>
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
                artist_id={album.artist.id}
                artist_name={album.artist.name}
                album_id={album.id}
                album_name={album.name}
                album_cover={album.cover_url}
                first_release_date={album.first_release_date}
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
              <SongCard album_cover={song.album_object.cover_url} album_id={song.album_object.id} album_name={song.album_object.name} artist_id={song.artist_object.id} artist_name={song.artist} path={song.path} song_id={song.id} song_name={song.name} />
            </div>
          ))}
        </div>
      </ScrollButtons>
    </div>
  );
}