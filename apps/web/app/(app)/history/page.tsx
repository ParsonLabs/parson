"use client"

import getBaseURL from "@/lib/Server/getBaseURL";

import { useState, useEffect } from "react";
import BigCard from "@/components/Music/Card/BigCard";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { LibrarySong } from "@music/sdk/types";
import getSession from "@/lib/Authentication/JWT/getSession";

export default function HistoryPage() {
  const [listenHistorySongs, setListenHistorySongs] = useState<LibrarySong[]>([]);

  useEffect(() => {
    const fetchListenHistory = async () => {
      const session = getSession()

      if (session) {
        const listenHistoryItems = await getListenHistory(Number(session.sub));
        const songDetailsPromises = listenHistoryItems.reverse().map(item => getSongInfo(item.song_id));
        const songDetails = await Promise.all(songDetailsPromises);
        
        setListenHistorySongs(songDetails);
      }
    };
  
    fetchListenHistory();
  }, []);

  return (
    <>
      <h1 className="text-3xl font-bold pt-20">History</h1>

      <ScrollArea>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 h-full w-full">
          {listenHistorySongs.map((song, index) => (
            <div className="h-64" key={index}>
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
      </ScrollArea>
    </>
  );
}
