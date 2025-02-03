"use client"

import getBaseURL from "@/lib/Server/getBaseURL";

import { usePlayer } from "@/components/Music/Player/usePlayer";
import PlaylistCard from "@/components/Music/Playlist/PlaylistCard";
import getSession from "@/lib/Authentication/JWT/getSession";
import { Album, Artist, LibrarySong, Song } from "@music/sdk/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@music/ui/components/table";
import Link from "next/link";
import SongContextMenu from "../SongContextMenu";
import { useSession } from "@/components/Providers/AuthProvider";

type PlaylistTableProps = {
  songsWithMetadata: (LibrarySong & { date_added: string })[];
}

export default function PlaylistTable({ songsWithMetadata }: PlaylistTableProps) {
  const { setImageSrc, setSong, setArtist, setAudioSource, setAlbum } = usePlayer()

  const { session } = useSession()

  const handlePlay = async (coverURL: string, song: LibrarySong, songURL: string, artist: Artist, album: Album) => {
    setImageSrc(`${getBaseURL()}/image/${encodeURIComponent(coverURL)}`)
    setArtist(artist)
    setAlbum(album)
    setSong(song)
    setAudioSource(songURL)
  }

  function formatDuration(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  const sortedSongs = [...songsWithMetadata].sort((a, b) => new Date(b.date_added).getTime() - new Date(a.date_added).getTime()).reverse();

  return (
    <div className="pb-36">
      <Table className="w-full">
        <TableHeader>
          <TableRow className="border-b border-white/5">
            <TableHead className="w-14">#</TableHead>
            <TableHead className="w-[40%]">Title</TableHead>
            <TableHead className="w-[25%]">Album</TableHead>
            <TableHead className="w-24">Duration</TableHead>
            <TableHead className="text-right">Artist</TableHead>
          </TableRow>
        </TableHeader>
  
        {sortedSongs.map((song: LibrarySong & { album_object: Album, artist_object: Artist }, index) => (
          <SongContextMenu
            key={song.id}
            song_name={song.name}
            song_id={song.id}
            artist_id={song.artist_object.id}
            artist_name={song.artist_object.name}
            album_id={song.album_object.id}
            album_name={song.album_object.name}
          >
            <TableBody>
              <TableRow 
                onClick={() => handlePlay(
                  song.album_object.cover_url, 
                  song, 
                  `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${session && session.bitrate}`, 
                  song.artist_object, 
                  song.album_object
                )}
                className="group hover:bg-white/5 transition-colors cursor-pointer"
              >
                <TableCell className="font-medium text-neutral-400 group-hover:text-white">
                  {index + 1}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3 max-w-[500px]">
                    <PlaylistCard 
                      song={song} 
                      coverURL={song.album_object.cover_url} 
                      artist={song.artist_object} 
                      album={song.album_object} 
                    />
                  </div>
                </TableCell>
                <TableCell>
                  <Link 
                    onClick={(e) => e.stopPropagation()} 
                    href={`/album?id=${song.album_object.id}`}
                    className="hover:underline text-neutral-400 hover:text-white transition-colors"
                  >
                    {song.album_object.name}
                  </Link>
                </TableCell>
                <TableCell className="text-neutral-400">
                  {formatDuration(song.duration)}
                </TableCell>
                <TableCell className="text-right">
                  <Link 
                    onClick={(e) => e.stopPropagation()}
                    href={`/artist?id=${song.artist_object.id}`}
                    className="hover:underline text-neutral-400 hover:text-white transition-colors"
                  >
                    {song.artist_object.name}
                  </Link>
                </TableCell>
              </TableRow>
            </TableBody>
          </SongContextMenu>
        ))}
      </Table>
    </div>
  );
}
