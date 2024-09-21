import { usePlayer } from "@/components/Music/Player/usePlayer";
import getSession from "@/lib/Authentication/JWT/getSession";
import getBaseURL from '@/lib/Server/getBaseURL';
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@music/ui/components/table";
import { distance } from 'fastest-levenshtein';
import { useEffect, useState } from 'react';
import PlaylistCard from '../Playlist/PlaylistCard';
import SongContextMenu from "../SongContextMenu";
import { getArtistInfo } from "@music/sdk";
import Link from "next/link";

type PlaylistTableProps = {
  songs: LibrarySong[]
  album: Album & { artist_object: Artist }
  artist: Artist
}

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
}

function isSimilarLevenshtein(apiTrack: string, userTrack: string): boolean {
  const normalizedApiTrack = normalizeString(apiTrack);
  const normalizedUserTrack = normalizeString(userTrack);
  const levenshteinDistance = distance(normalizedApiTrack, normalizedUserTrack);
  const maxLength = Math.max(normalizedApiTrack.length, normalizedUserTrack.length);
  const similarity = 1 - (levenshteinDistance / maxLength);
  return similarity > 0.6;
}

export default function AlbumTable({ songs, album, artist }: PlaylistTableProps) {
  const { setImageSrc, setSong, setAudioSource, setArtist, setAlbum, addToQueue, setPlayedFromAlbum } = usePlayer();
  const [orderedSongs, setOrderedSongs] = useState<LibrarySong[]>([]);
  const [contributingArtists, setContributingArtists] = useState<{ [key: string]: Artist[] }>({});

  const session = getSession();
  const bitrate = session?.bitrate ?? 0;

  useEffect(() => {
    if (album.release_album) {
      const apiTracks = album.release_album.tracks.map(track => track.track_name);
      const userTracks = songs.map(song => song.name);

      const categorizedTracks = apiTracks.map(apiTrack => {
        const similarTracks = userTracks.filter(userTrack => isSimilarLevenshtein(apiTrack, userTrack));
        return {
          apiTrack,
          similarTracks
        };
      });

      const ordered: any[] = [];
      const remaining = [...songs];

      categorizedTracks.forEach(({ apiTrack, similarTracks }) => {
        similarTracks.forEach(similarTrack => {
          const song = songs.find(song => song.name === similarTrack);
          if (song) {
            ordered.push(song);
            const index = remaining.indexOf(song);
            if (index > -1) {
              remaining.splice(index, 1);
            }
          }
        });
      });

      setOrderedSongs([...ordered, ...remaining]);
    } else {
      setOrderedSongs(songs);
    }
  }, [songs, album]);

  useEffect(() => {
    const fetchContributingArtists = async () => {
      const artistMap: { [key: string]: Artist[] } = {};

      for (const song of songs) {
        const artistPromises = song.contributing_artist_ids.map(id => getArtistInfo(id));
        const artists = await Promise.all(artistPromises);
        artistMap[song.id] = artists;
      }

      setContributingArtists(artistMap);
    };

    fetchContributingArtists();
  }, [songs]);

  const handlePlay = async (coverURL: string, song: LibrarySong, songURL: string, artist: Artist) => {
    setImageSrc(`${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}`);
    setArtist(artist);
    setAlbum(album);
    setSong(song);
    setAudioSource(songURL);
    setPlayedFromAlbum(true)
  };

  function formatDuration(duration: number) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.round(duration % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  function sanitizeSongName(songName: string) {
    return songName.replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
  }

  return (
    <div className="pb-24">
      <Table>
        {/* <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">#</TableHead>
            <TableHead className="w-[200px]">Title</TableHead>
            <TableHead className="text-right">Duration</TableHead>
          </TableRow>
        </TableHeader> */}
    
        {orderedSongs.map(song => (
          <SongContextMenu
            song_name={song.name}
            song_id={song.id}
            artist_id={artist.id}
            artist_name={artist.name}
            album_id={album.id}
            album_name={album.name}
            key={song.id}
          >            
            <TableBody key={song.id} >
              <TableRow id={sanitizeSongName(song.name)} onClick={() => handlePlay(album.cover_url, song, `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${bitrate}`, artist)}>
                <TableCell className="font-medium">{song.track_number}</TableCell>
                <TableCell>
                  <div className="w-[300px] overflow-hidden whitespace-nowrap text-overflow">
                    <PlaylistCard song={song} coverURL={album.cover_url} artist={artist} album={album} showCover={false} showArtist={false} />
                    <div className="text-gray-500">
                      <Link href={`/artist?id=${artist.id}`}>
                        {artist.name}
                      </Link>
                      {(contributingArtists[song.id]?.length ?? 0) > 0 && ', '}
                      {(contributingArtists[song.id] ?? []).map((contributingArtist, index) => (
                        <span key={contributingArtist.id}>
                          <Link href={`/artist?id=${contributingArtist.id}`} onClick={(e) => e.stopPropagation()}>
                            {contributingArtist.name}
                          </Link>
                          {index < (contributingArtists[song.id]?.length ?? 0) - 1 && ', '}
                        </span>
                      ))}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">{formatDuration(song.duration)}</TableCell>
              </TableRow>
            </TableBody>
          </SongContextMenu>
        ))}
      </Table>
    </div>
  )
}