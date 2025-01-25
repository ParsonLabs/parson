"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getListenAgain, ListenAgainSong } from "@music/sdk";
import PageGradient from "../Layout/PageGradient";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import SongCard from "../Music/Card/SongCard";
import ScrollButtons from "./ScrollButtons";
import { useSession } from "../Providers/AuthProvider";

interface ListenAgainProps {
  genre?: string;
}

const MemoizedAlbumCard = memo(AlbumCard);
const MemoizedSongCard = memo(SongCard);

export default function ListenAgain({ genre }: ListenAgainProps) {
  const { session } = useSession();

  const { data: listenHistorySongs = [] } = useQuery({
    queryKey: ['listenHistory', session?.sub, genre],
    queryFn: () => getListenAgain(Number(session?.sub)),
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.sub
  });

  if (!listenHistorySongs[0] || listenHistorySongs.length === 0) return null;

  const albumCoverSrc = listenHistorySongs[0].album_cover.length === 0
    ? "/snf.png"
    : `${getBaseURL()}/image/${encodeURIComponent(listenHistorySongs[0].album_cover)}`;

  return (
    <>
      <PageGradient imageSrc={albumCoverSrc} />
      <ScrollButtons heading="Listen Again" showUser id="ListenAgain">
        <div className="flex flex-row pb-14">
          {listenHistorySongs.map((item) => {
            if (item.item_type === "album") {
              return (
                <div className="mr-20" key={`album-${item.album_id}`}>
                  <MemoizedAlbumCard
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
            }
            return (
              <div className="mr-20" key={`song-${item.song_id}`}>
                <MemoizedSongCard
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
          })}
        </div>
      </ScrollButtons>
    </>
  );
}