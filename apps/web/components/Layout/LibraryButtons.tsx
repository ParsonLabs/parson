"use client";

import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { useEffect, useState } from "react";
import ArtistCard from "../Music/Artist/ArtistCard";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import SongCard from "../Music/Card/SongCard";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { useSession } from "../Providers/AuthProvider";

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

const libraryFields = ["Playlists", "Songs", "Albums", "Artists"];

export default function LibraryButtons({ initialSelectedField = null }: { initialSelectedField?: string | null }) {
  const [selectedField, setSelectedField] = useState<string | null>(initialSelectedField);
  const [listenHistorySongs, setListenHistorySongs] = useState<LibrarySong[]>([]);
  const [randomCombination, setRandomCombination] = useState<any[]>([]);
  const [albumsMap, setAlbumsMap] = useState<{ [key: string]: LibrarySong[] }>({});
  const [artistsMap, setArtistsMap] = useState<{ [key: string]: LibrarySong[] }>({});

  const handleFieldClick = (field: string) => {
    setSelectedField(prevField => (prevField === field ? null : field));
  };

  const { setGradient } = useGradientHover();
  setGradient("#000000");

  const { session } = useSession();

  useEffect(() => {
    const fetchListenHistory = async () => {
      const cacheKey = "listenAgain";
      const cachedData = getCache(cacheKey);

      if (cachedData) {
        setListenHistorySongs(cachedData);
        return;
      }

      if (session && session.sub) {
        const userId = Number(session.sub);
        if (!isNaN(userId) && userId > 0) {
          try {
            const listenHistoryItems = await getListenHistory(userId);
            const uniqueListenHistoryItems = Array.from(new Set(listenHistoryItems.map(item => item.song_id)));
            
            const songDetailsPromises = uniqueListenHistoryItems.reverse().slice(0, 30).map(song_id => 
              getSongInfo(song_id).catch(() => null)
            );
            
            const results = await Promise.all(songDetailsPromises);
            const songDetails = results.filter(Boolean) as unknown as LibrarySong[];

            setListenHistorySongs(songDetails);
            setCache(cacheKey, songDetails, 3600000);
          } catch (error) {
            console.error("Error fetching listen history:", error);
            setListenHistorySongs([]);
          }
        }
      }
    };

    fetchListenHistory();
  }, [session]);

  useEffect(() => {
    const albumsMap = listenHistorySongs.reduce((acc: { [key: string]: LibrarySong[] }, song: LibrarySong) => {
      if (song?.album_object?.id) {
        const albumId = song.album_object.id;
        if (!acc[albumId]) {
          acc[albumId] = [];
        }
        acc[albumId].push(song);
      }
      return acc;
    }, {});

    const artistsMap = listenHistorySongs.reduce((acc: { [key: string]: LibrarySong[] }, song: LibrarySong) => {
      if (song?.artist_object?.id) {
        const artistId = song.artist_object.id;
        if (!acc[artistId]) {
          acc[artistId] = [];
        }
        acc[artistId].push(song);
      }
      return acc;
    }, {});

    setAlbumsMap(albumsMap);
    setArtistsMap(artistsMap);

    const getRandomCombination = () => {
      const allItems = [
        ...listenHistorySongs
          .filter(song => song?.album_object && song?.artist_object)
          .map(song => ({ type: 'song', data: song })),
        ...Object.values(albumsMap)
          .filter(songs => songs.length > 0 && songs[0]?.album_object)
          .map(songs => ({ type: 'album', data: songs[0] })),
        ...Object.values(artistsMap)
          .filter(songs => songs.length > 0 && songs[0]?.artist_object)
          .map(songs => ({ type: 'artist', data: songs[0] }))
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
          {listenHistorySongs
            .filter(song => song?.album_object && song?.artist_object)
            .map((song, index) => (
              <div
                className="relative flex items-center justify-center overflow-hidden w-full h-96 rounded-lg scale-90"
                key={index}
              >
                <SongCard 
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
      ) : selectedField === "Albums" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-1 overflow-hidden">
          {Object.values(albumsMap).map((songs: LibrarySong[], index) => {
            const album = songs[0]?.album_object;
            const artist = songs[0]?.artist_object;

            if (album && artist) {
              return (
                <div className="relative flex items-center justify-center overflow-hidden w-full h-96 scale-90 rounded-lg" key={index}>
                  <AlbumCard 
                    artist_id={artist.id}
                    artist_name={artist.name}
                    album_id={album.id}
                    album_name={album.name}
                    album_cover={album.cover_url}
                    album_songs_count={album.songs?.length || 0}
                    first_release_date={album.first_release_date}
                  />
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
          {randomCombination.map((item, index) => {
            if (!item?.data) return null;
            
            return (
              <div className="relative flex items-center justify-center overflow-hidden w-full h-96 scale-90 rounded-lg" key={index}>
                {item.type === 'song' && item.data?.album_object && item.data?.artist_object ? (
                  <SongCard 
                    album_cover={item.data.album_object.cover_url} 
                    album_id={item.data.album_object.id} 
                    album_name={item.data.album_object.name} 
                    artist_id={item.data.artist_object.id} 
                    artist_name={item.data.artist_object.name} 
                    path={item.data.path} 
                    song_id={item.data.id} 
                    song_name={item.data.name} 
                  />              
                ) : item.type === 'album' && item.data?.album_object && item.data?.artist_object ? (
                  <AlbumCard 
                    artist_id={item.data.artist_object.id}
                    artist_name={item.data.artist_object.name}
                    album_id={item.data.album_object.id}
                    album_name={item.data.album_object.name}
                    album_cover={item.data.album_object.cover_url}
                    album_songs_count={item.data.album_object.songs?.length || 0}
                    first_release_date={item.data.album_object.first_release_date}
                  />              
                ) : item.data?.artist_object && <ArtistCard artist={item.data.artist_object} />
                }
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}