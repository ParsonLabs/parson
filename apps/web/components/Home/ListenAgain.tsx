"use client"

import getBaseURL from "@/lib/Server/getBaseURL";
import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import PageGradient from "../Layout/PageGradient";
import BigCard from "../Music/Card/BigCard";
import ScrollButtons from "./ScrollButtons";
import AlbumCard from "../Music/Card/Album/AlbumCard";

interface ListenAgainProps {
  genre?: string;
}

export default function ListenAgain({ genre }: ListenAgainProps) {
  const [listenHistorySongs, setListenHistorySongs] = useState<LibrarySong[]>([]);

  useEffect(() => {
    const fetchListenHistory = async () => {
      const cacheKey = genre ? `listenAgain_${genre}` : "listenAgain";
      const cachedData = genre ? null : getCache(cacheKey);

      if (cachedData) {
        setListenHistorySongs(cachedData);
      } else {
        const session = getSession();
        if (session && session.sub) {
          const userId = Number(session.sub);
          if (!isNaN(userId) && userId > 0) {
            const listenHistoryItems = await getListenHistory(userId);
            const uniqueListenHistoryItems = Array.from(new Set(listenHistoryItems.map(item => item.song_id)));
            const songDetailsPromises = uniqueListenHistoryItems.reverse().slice(0, 30).map(song_id => getSongInfo(song_id));
            const songDetails = await Promise.all(songDetailsPromises);

            const filteredSongs = genre
              ? songDetails.filter(song => {
                  const releaseAlbumGenres = song.album_object.release_album?.genres?.some(g => g.name === genre);
                  const releaseGroupAlbumGenres = song.album_object.release_group_album?.genres?.some(g => g.name === genre);
                  return releaseAlbumGenres || releaseGroupAlbumGenres;
                })
              : songDetails;

            setListenHistorySongs(filteredSongs);
            if (!genre) {
              setCache(cacheKey, filteredSongs, 3600000);
            }
          } else {
            console.error("Invalid user ID:", userId);
          }
        } else {
          console.error("Invalid session or session.sub:", session);
        }
      }
    };

    fetchListenHistory();
  }, [genre]);

  if (!(listenHistorySongs[0]) || listenHistorySongs.length === 0) return null;

  const albumCoverSrc = listenHistorySongs[0].album_object.cover_url.length === 0
    ? "/snf.png"
    : `${getBaseURL()}/image/${encodeURIComponent(listenHistorySongs[0].album_object.cover_url)}`;

  const albumsMap = listenHistorySongs.reduce((acc: { [key: string]: LibrarySong[] }, song: LibrarySong) => {
    const albumId = song.album_object.id;
    if (!acc[albumId]) {
      acc[albumId] = [];
    }
    acc[albumId].push(song);
    return acc;
  }, {});

  return listenHistorySongs && (
    <>
      <PageGradient imageSrc={albumCoverSrc} />
      <ScrollButtons heading="Listen Again">
        <div className="flex flex-row">
          {Object.values(albumsMap).map((songs: LibrarySong[], index) => {
            const album = songs[0]?.album_object;
            const artist = songs[0]?.artist_object;

            if (songs.length > 3 && artist && album) {
              return (
                <div className="mr-20" key={index}>
                  <AlbumCard artist={artist} album={album} />
                </div>
              );
            } else {
              return songs.map((song, songIndex) => (
                <div className="mr-20" key={`${index}-${songIndex}`}>
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
              ));
            }
          })}
        </div>
      </ScrollButtons>
    </>
  );
}