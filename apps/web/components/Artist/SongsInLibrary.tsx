import getSession from "@/lib/Authentication/JWT/getSession";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ScrollButtons from "../Home/ScrollButtons";
import BigCard from "../Music/Card/BigCard";

async function getSongsFromYourLibrary(user_id: number, artist_id: string) {
  const playlists = await getPlaylists(user_id);

  const playlistSongIDsPromises = playlists.map(async (playlist) => {
    const individualPlaylist = await getPlaylist(playlist.id);
    return individualPlaylist.song_infos.map((songInfo) => songInfo.song_id);
  });

  const playlistSongIDsArrays = await Promise.all(playlistSongIDsPromises);
  const playlistSongIDs = playlistSongIDsArrays.flat();

  const songsDetailsPromises = playlistSongIDs.map((songID) => getSongInfo(String(songID)));

  const songsDetails = await Promise.all(songsDetailsPromises);

  const filteredSongsDetails = songsDetails.filter(song => String(song.artist_object.id) === artist_id);

  return filteredSongsDetails;
}

export default function FromYourLibrary() {
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  useEffect(() => {
    const session = getSession();

    async function fetchSongs() {
      if (session && id) {
        const songs = await getSongsFromYourLibrary(Number(session.sub), id);
        setLibrarySongs(songs);
        setLoading(false);
      }
    }

    fetchSongs();
  }, [id]);

  return librarySongs.length > 0 && (
    <ScrollButtons heading="In your Library">
      <div className="flex flex-row justify-start items-start">
        {librarySongs.map((song, index) => (
          <div key={index} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 p-8">
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
              songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}`}
              type="Song"
              song={song}
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}
