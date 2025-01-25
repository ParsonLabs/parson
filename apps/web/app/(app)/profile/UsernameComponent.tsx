"use client";

import FollowButton from "@/components/Friends/FollowButton";
import ArtistCard from "@/components/Music/Artist/ArtistCard";
import { useSession } from "@/components/Providers/AuthProvider";
import { getCache } from "@/lib/Caching/cache";
import {
  getListenHistory,
  getProfilePicture,
  getSongInfo,
  getUserInfo,
  LibraryAlbum,
} from "@music/sdk";
import { Artist, LibrarySong } from "@music/sdk/types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@music/ui/components/avatar";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Play } from "lucide-react";
import getBaseURL from "@/lib/Server/getBaseURL";

export default function UsernameComponent() {
  const searchParams = useSearchParams();
  const username = searchParams?.get("username");

  const [user, setUser] = useState<any>(null);
  const [topArtists, setTopArtists] = useState<(Artist & { count: number })[]>(
    []
  );
  const [topAlbums, setTopAlbums] = useState<
    (LibraryAlbum & { count: number; artist: Artist })[]
  >([]);
  const [topSongs, setTopSongs] = useState<(LibrarySong & { count: number })[]>(
    []
  );
  const [profilePicture, setProfilePicture] = useState<string | null>(null);
  const { session } = useSession();

  function formatPlayCount(count: number) {
    return `${count} ${count === 1 ? "play" : "plays"}`;
  }

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

      const songInfoPromises = listenHistory.map(
        async (history: { song_id: string }) => {
          const songCacheKey = `${songInfoCacheKey}_${history.song_id}`;
          let songInfo = getCache(songCacheKey);
          if (!songInfo) {
            songInfo = await getSongInfo(history.song_id);
          }
          return songInfo;
        }
      );
      const songsInfo = await Promise.all(songInfoPromises);

      const artistFrequency: Record<string, { count: number; info: Artist }> =
        songsInfo.reduce((acc, song) => {
          const artistId = song.artist_object.id;
          if (!acc[artistId]) {
            acc[artistId] = { count: 0, info: song.artist_object };
          }
          acc[artistId].count++;
          return acc;
        }, {});

      const albumFrequency: Record<
        string,
        { count: number; info: LibraryAlbum; artist: Artist }
      > = songsInfo.reduce((acc, song) => {
        const albumId = song.album_object.id;
        if (!acc[albumId]) {
          acc[albumId] = {
            count: 0,
            info: song.album_object,
            artist: song.artist_object,
          };
        }
        acc[albumId].count++;
        return acc;
      }, {});

      const songFrequency: Record<
        string,
        { count: number; info: LibrarySong }
      > = songsInfo.reduce((acc, song) => {
        const songId = song.id;
        if (!acc[songId]) {
          acc[songId] = { count: 0, info: song };
        }
        acc[songId].count++;
        return acc;
      }, {});

      const sortedArtists = Object.values(artistFrequency)
        .sort((a, b) => b.count - a.count)
        .map((artist) => ({
          ...artist.info,
          count: artist.count,
          playCount: formatPlayCount(artist.count),
        }));

      const sortedAlbums = Object.values(albumFrequency)
        .sort((a, b) => b.count - a.count)
        .map((album) => ({
          ...album.info,
          artist: album.artist,
          count: album.count,
          playCount: formatPlayCount(album.count),
          cover_url:
            album.info.cover_url.length === 0
              ? "/snf.png"
              : `${getBaseURL()}/image/${encodeURIComponent(album.info.cover_url)}`,
        }));

      const sortedSongs = Object.values(songFrequency)
        .sort((a, b) => b.count - a.count)
        .map((song) => ({
          ...song.info,
          count: song.count,
          playCount: formatPlayCount(song.count),
          album_object: {
            ...song.info.album_object,
            cover_url:
              song.info.album_object.cover_url.length === 0
                ? "/snf.png"
                : `${getBaseURL()}/image/${encodeURIComponent(song.info.album_object.cover_url)}`,
          },
        }));

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
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />

      <div
        className="fixed inset-0 opacity-30 will-change-transform"
        style={{
          backgroundImage: `url(${profilePicture ?? ""})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(140px)",
          transform: "translateZ(0)",
        }}
      />

      <div className="relative z-10 px-4 md:px-8 pt-8 pb-8 backdrop-blur-sm">
        <div className="max-w-8xl mx-auto">
          <div className="flex flex-col items-center md:items-start md:flex-row gap-6 mb-12">
            <div className="flex-shrink-0">
              {profilePicture ? (
                <Avatar className="w-48 h-48 md:w-[200px] md:h-[200px] shadow-2xl">
                  <AvatarImage
                    src={profilePicture}
                    alt="User Profile Picture"
                    className="bg-gray-600"
                  />
                </Avatar>
              ) : (
                <Avatar className="w-48 h-48 md:w-[200px] md:h-[200px] shadow-2xl">
                  <AvatarFallback className="text-6xl">
                    {user.username.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>

            <div className="flex flex-col justify-end text-center md:text-left">
              <h1 className="text-4xl md:text-7xl font-bold mb-4 text-white">
                {user.username}
              </h1>
              {user.username !== session?.username && (
                <div className="flex justify-center md:justify-start">
                  <FollowButton userIDToFollow={user.id} />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-8">
            {topArtists.length > 0 && (
              <div className="bg-black/20 rounded-xl p-4">
                <h2 className="text-2xl font-bold text-white mb-4">
                  Top Artists
                </h2>
                <ScrollArea>
                  <div className="flex space-x-4 pb-4">
                    {topArtists.map((artist) => (
                      <div key={artist.id} className="w-[200px] flex-none">
                        <ArtistCard artist={artist} />
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            )}

            {topAlbums.length > 0 && (
              <div className="bg-black/20 rounded-xl p-4">
                <h2 className="text-2xl font-bold text-white mb-4">
                  Top Albums
                </h2>
                <ScrollArea>
                  <div className="flex space-x-4 pb-4">
                    {topAlbums.map((album) => (
                      <div key={album.id} className="w-[200px] flex-none">
                        <Link href={`/album?id=${album.id}`}>
                          <div className="group relative aspect-square rounded-lg overflow-hidden mb-3">
                            <Image
                              src={album.cover_url}
                              alt={album.name}
                              layout="fill"
                              className="object-cover transition-all duration-300 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="font-medium text-white truncate">
                              {album.name}
                            </h3>
                            <p className="text-sm text-gray-400 truncate">
                              {album.artist.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {formatPlayCount(album.count)}
                            </p>
                          </div>
                        </Link>
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            )}

            {topSongs.length > 0 && (
              <div className="bg-black/20 rounded-xl p-4">
                <h2 className="text-2xl font-bold text-white mb-4">
                  Top Songs
                </h2>
                <ScrollArea>
                  <div className="flex space-x-4 pb-4">
                    {topSongs.map((song) => (
                      <div key={song.id} className="w-[200px] flex-none">
                        <div className="group relative aspect-square rounded-lg overflow-hidden mb-3">
                          <Image
                            src={song.album_object.cover_url}
                            alt={song.name}
                            layout="fill"
                            className="object-cover transition-all duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Play
                              className="w-12 h-12 text-white"
                              fill="white"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <h3 className="font-medium text-white truncate">
                            {song.name}
                          </h3>
                          <p className="text-sm text-gray-400 truncate">
                            {song.artist}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatPlayCount(song.count)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
