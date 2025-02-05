import { getPlaylist, getPlaylists, getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/Providers/AuthProvider";
import SongRow from "@/components/Music/Card/SongRow";

async function getSongsFromYourLibrary(user_id: number, artist_id: string) {
  const playlists = await getPlaylists(user_id);
  const playlistSongIDsPromises = playlists.map(async (playlist) => {
    const individualPlaylist = await getPlaylist(playlist.id);
    return individualPlaylist.song_infos.map((songInfo) => songInfo.song_id);
  });

  const playlistSongIDsArrays = await Promise.all(playlistSongIDsPromises);
  const playlistSongIDs = playlistSongIDsArrays.flat();
  const songsDetailsPromises = playlistSongIDs.map((songID) => getSongInfo(String(songID)));
  const songsDetails = await Promise.all(songsDetailsPromises) as LibrarySong[];
  return songsDetails.filter(song => String(song.artist_object.id) === artist_id);
}

export default function ArtistSongsInLibrary() {
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");
  const { session } = useSession();

  useEffect(() => {
    async function fetchSongs() {
      if (session && id) {
        const songs = await getSongsFromYourLibrary(Number(session.sub), id);
        setLibrarySongs(songs);
      }
    }
    fetchSongs();
  }, [id, session]);

  if (librarySongs.length === 0) return null;

  return (
    <div className="mb-8 mt-8">
      <h2 className="text-2xl font-bold text-white mb-4">In Your Library</h2>
      <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4">
        <div className="space-y-2">
          {librarySongs.slice(0, 5).map((song) => (
            <SongRow
              key={song.id}
              song_name={song.name}
              song_id={song.id}
              artist_id={song.artist_object.id}
              artist_name={song.artist}
              album_id={song.album_object.id}
              album_name={song.album_object.name}
              album_cover={song.album_object.cover_url}
              path={song.path}
              duration={song.duration}
            />
          ))}
        </div>
      </div>
    </div>
  );
}