"use client"


import SongCard from "@/components/Music/Card/SongCard";
import { useSession } from "@/components/Providers/AuthProvider";
import getSession from "@/lib/Authentication/JWT/getSession";
import { getListenHistory, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { useEffect, useState } from "react";

export default function HistoryPage() {
  const [listenHistorySongs, setListenHistorySongs] = useState<LibrarySong[]>([]);

  const { session } = useSession()

  useEffect(() => {
    const fetchListenHistory = async () => {

      if (session) {
        const listenHistoryItems = await getListenHistory(Number(session.sub));
        const songDetailsPromises = listenHistoryItems.reverse().map(item => getSongInfo(item.song_id));
        const songDetails = await Promise.all(songDetailsPromises) as LibrarySong[];
        
        setListenHistorySongs(songDetails);
      }
    };
  
    fetchListenHistory();
  }, [session]);

  return (
    <>
      <h1 className="text-3xl font-bold pt-20">History</h1>

      <ScrollArea>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 h-full w-full">
          {listenHistorySongs.map((song, index) => (
            <div className="h-64" key={index}>
              <SongCard album_cover={song.album_object.cover_url} album_id={song.album_object.id} album_name={song.album_object.name} artist_id={song.artist_object.id} artist_name={song.artist} path={song.path} song_id={song.id} song_name={song.name} />
            </div>
          ))}
        </div>
      </ScrollArea>
    </>
  );
}
