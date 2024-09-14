"use client";

import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { useState, useEffect } from "react";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import getBaseURL from "@/lib/Server/getBaseURL";
import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import BigCard from "../Music/Card/BigCard";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import ArtistCard from "../Music/Artist/ArtistCard";

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

const libraryFields = ["Playlists", "Songs", "Albums", "Artists"];

export default function LibraryButtons() {
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [listenHistorySongs, setListenHistorySongs] = useState<LibrarySong[]>([]);
  const [randomCombination, setRandomCombination] = useState<any[]>([]);
  const [albumsMap, setAlbumsMap] = useState<{ [key: string]: LibrarySong[] }>({});
  const [artistsMap, setArtistsMap] = useState<{ [key: string]: LibrarySong[] }>({});

  const handleFieldClick = (field: string) => {
    setSelectedField(prevField => (prevField === field ? null : field));
  };

  const { setGradient } = useGradientHover();
  setGradient("#000000");

  useEffect(() => {
    const fetchListenHistory = async () => {
      const cacheKey = "listenAgain";
      const cachedData = getCache(cacheKey);

      if (cachedData) {
        setListenHistorySongs(cachedData);
        return;
      }

      const session = getSession();
      if (session && session.sub) {
        const userId = Number(session.sub);
        if (!isNaN(userId) && userId > 0) {
          const listenHistoryItems = await getListenHistory(userId);
          const uniqueListenHistoryItems = Array.from(new Set(listenHistoryItems.map(item => item.song_id)));
          const songDetailsPromises = uniqueListenHistoryItems.reverse().slice(0, 30).map(song_id => getSongInfo(song_id));
          const songDetails = await Promise.all(songDetailsPromises);

          setListenHistorySongs(songDetails);
          setCache(cacheKey, songDetails, 3600000);
        }
      }
    };

    fetchListenHistory();
  }, []);

  useEffect(() => {
    const albumsMap = listenHistorySongs.reduce((acc: { [key: string]: LibrarySong[] }, song: LibrarySong) => {
      const albumId = song.album_object.id;
      if (!acc[albumId]) {
        acc[albumId] = [];
      }
      acc[albumId].push(song);
      return acc;
    }, {});

    const artistsMap = listenHistorySongs.reduce((acc: { [key: string]: LibrarySong[] }, song: LibrarySong) => {
      const artistId = song.artist_object.id;
      if (!acc[artistId]) {
        acc[artistId] = [];
      }
      acc[artistId].push(song);
      return acc;
    }, {});

    setAlbumsMap(albumsMap);
    setArtistsMap(artistsMap);

    const getRandomCombination = () => {
      const allItems = [
        ...listenHistorySongs.map(song => ({ type: 'song', data: song })),
        ...Object.values(albumsMap).map(songs => ({ type: 'album', data: songs[0] })),
        ...Object.values(artistsMap).map(songs => ({ type: 'artist', data: songs[0] }))
      ];
      return allItems.sort(() => 0.5 - Math.random());
    };

    setRandomCombination(getRandomCombination());
  }, [listenHistorySongs]);

  return (
    <>
      <ScrollArea className="w-full whitespace-nowrap rounded-md">
        <div className="pt-20 flex w-max space-x-4 p-4">
          {libraryFields.map((field, index) => (
            <button
              key={index}
              className={`shrink-0 m-2 px-3 py-1 rounded-xl text-sm ${selectedField === field ? 'bg-white text-black' : 'bg-[#353535] text-white'}`}
              onClick={() => handleFieldClick(field)}
            >
              {capitalizeWords(field)}
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {selectedField === "Songs" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-1 overflow-hidden">
          {listenHistorySongs.map((song, index) => (
            <div
              className="relative flex items-center justify-center overflow-hidden w-full h-96 rounded-lg scale-90"
              key={index}
            >
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
      ) : selectedField === "Albums" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-1 overflow-hidden">
          {Object.values(albumsMap).map((songs: LibrarySong[], index) => {
            const album = songs[0]?.album_object;
            const artist = songs[0]?.artist_object;

            if (album && artist) {
              return (
                <div className="relative flex items-center justify-center overflow-hidden w-full h-96 scale-90 rounded-lg" key={index}>
                  <AlbumCard artist={artist} album={album} />
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : selectedField === "Artists" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-1 overflow-hidden">
          {Object.values(artistsMap).map((songs: LibrarySong[], index) => {
            const artist = songs[0]?.artist_object;

            if (artist) {
              return (
                <div className="relative flex items-center justify-center overflow-hidden w-full h-96 scale-90 rounded-lg" key={index}>
                  <ArtistCard artist={artist} />
                </div>
              );
            }
            return null;
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-1 overflow-hidden">
          {randomCombination.map((item, index) => (
            <div className="relative flex items-center justify-center overflow-hidden w-full h-96 scale-90 rounded-lg" key={index}>
              {item.type === 'song' && item.data ? (
                <BigCard
                  title={item.data.name}
                  album={item.data.album_object}
                  artist={item.data.artist_object}
                  imageSrc={
                    item.data.album_object.cover_url.length === 0
                      ? "/snf.png"
                      : `${getBaseURL()}/image/${encodeURIComponent(item.data.album_object.cover_url)}`
                  }
                  albumURL=""
                  songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(item.data.path)}?bitrate=0`}
                  type="Song"
                  song={item.data}
                />
              ) : item.type === 'album' && item.data ? (
                <AlbumCard artist={item.data.artist_object} album={item.data.album_object} />
              ) : item.data && <ArtistCard artist={item.data.artist_object} />
              }
            </div>
          ))}
        </div>
      )}
    </>
  );
}