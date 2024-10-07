"use client";

import getSession from "@/lib/Authentication/JWT/getSession";
import setCache, { getCache } from "@/lib/Caching/cache";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getListenAgain, SongInfo } from "@music/sdk";
import { useEffect, useState } from "react";
import PageGradient from "../Layout/PageGradient";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import SongCard from "../Music/Card/SongCard";
import ScrollButtons from "./ScrollButtons";
import { useSession } from "../Providers/AuthProvider";

interface ListenAgainProps {
  genre?: string;
}

export default function ListenAgain({ genre }: ListenAgainProps) {
  const [listenHistorySongs, setListenHistorySongs] = useState<SongInfo[]>([]);
  const { session } = useSession()
  
  useEffect(() => {
    const fetchListenHistory = async () => {
      const listenHistory = await getListenAgain(Number(session?.sub));
      setListenHistorySongs(listenHistory);
    };

    fetchListenHistory();
  }, [genre, session?.sub]);

  if (!(listenHistorySongs[0]) || listenHistorySongs.length === 0) return null;

  const albumCoverSrc = listenHistorySongs[0].album_cover.length === 0
    ? "/snf.png"
    : `${getBaseURL()}/image/${encodeURIComponent(listenHistorySongs[0].album_cover)}`;

  return listenHistorySongs && (
    <>
      <PageGradient imageSrc={albumCoverSrc} />
      <ScrollButtons heading="Listen Again" showUser id="ListenAgain">
        <div className="flex flex-row pb-28">
          {listenHistorySongs.map((item, index) => {
            if (item.item_type === "album") {
              return (
                <div className="mr-20" key={index}>
                  <AlbumCard
                    artist_id={item.artist_id}
                    artist_name={item.artist_name}
                    album_id={item.album_id}
                    album_name={item.album_name}
                    album_cover={item.album_cover ?? ""}
                    album_songs_count={item.album_songs_count}
                    first_release_date={item.release_date}
                  />
                </div>
              );
            } else {
              return (
                <div className="mr-20" key={index}>
                  <SongCard
                    song_name={item.song_name}
                    song_id={item.song_id}
                    path={item.song_path}
                    artist_id={item.artist_id}
                    artist_name={item.artist_name}
                    album_id={item.album_id}
                    album_name={item.album_name}
                    album_cover={item.album_cover ?? ""}
                  />
                </div>
              );
            }
          })}
        </div>
      </ScrollButtons>
    </>
  );
}