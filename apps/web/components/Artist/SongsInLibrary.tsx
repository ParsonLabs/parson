import getSession from "@/lib/Authentication/JWT/getSession";
import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import ScrollButtons from "../Home/ScrollButtons";
import SongCard from "../Music/Card/SongCard";

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
    <ScrollButtons heading="In your Library" id="InYourLibrary">
      <div className="flex flex-row justify-start items-start pb-20">
        {librarySongs.map((song, index) => (
          <div key={index} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 p-8">
            <SongCard album_cover={song.album_object.cover_url} album_id={song.album_object.id} album_name={song.album_object.name} artist_id={song.artist_object.id} artist_name={song.artist} path={song.path} song_id={song.id} song_name={song.name} />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}
