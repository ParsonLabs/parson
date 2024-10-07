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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">#</TableHead>
            <TableHead className="w-[200px]">Title</TableHead>
            <TableHead className="w-[200px]">Album</TableHead>
            <TableHead className="w-[200px]">Duration</TableHead>
            <TableHead className="text-right">Artist</TableHead>
          </TableRow>
        </TableHeader>

        {sortedSongs.map((song: LibrarySong & { album_object: Album, artist_object: Artist }, index) => (
          <SongContextMenu
            song_name={song.name}
            song_id={song.id}
            artist_id={song.artist_object.id}
            artist_name={song.artist_object.name}
            album_id={song.album_object.id}
            album_name={song.album_object.name}
            key={song.id}
          >
            <TableBody key={song.id}>
              <TableRow onClick={() => handlePlay(song.album_object.cover_url, song, `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${session && session.bitrate}`, song.artist_object, song.album_object)}>
                <TableCell className="font-medium">{index + 1}</TableCell>
                <TableCell>
                  <div className="w-[300px] overflow-hidden whitespace-nowrap text-overflow">
                    <PlaylistCard song={song} coverURL={song.album_object.cover_url} artist={song.artist_object} album={song.album_object} />
                  </div>
                </TableCell>
                <TableCell><Link onClick={(e) => e.stopPropagation()} href={`/album?id=${song.album_object.id}`}>{song.album_object.name}</Link></TableCell>
                <TableCell>{formatDuration(song.duration)}</TableCell>
                <TableCell className="text-right"><Link onClick={(e) => e.stopPropagation()}href={`/artist?id=${song.artist_object.id}`}>{song.artist_object.name}</Link></TableCell>
              </TableRow>
            </TableBody>
          </SongContextMenu>
        ))}
      </Table>
    </div>
  )
}
