import getSession from '@/lib/Authentication/JWT/getSession';
import getBaseURL from "@/lib/Server/getBaseURL";
import { getAlbumInfo, getArtistInfo, getSongInfo, LibraryAlbum } from '@music/sdk';
import { Artist, CombinedItem, LibrarySong } from '@music/sdk/types';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import ArtistCard from '../../Artist/ArtistCard';
import AlbumCard from '../Album/AlbumCard';
import SongCard from '../SongCard';

type ResultCardProps = {
  result: CombinedItem 
}

export default function TopResultsCard({ result }: ResultCardProps) {
  const [artist, setArtist] = useState<Artist | null>(null)
  const [album, setAlbum] = useState<LibraryAlbum | null>(null)
  const [song, setSong] = useState<LibrarySong | null>(null)

  useEffect(() => {
    async function fetchInfo() {
      if (result.item_type === "song") {
        const song = await getSongInfo(result.id)
        setSong(song)
      }

      if (result.item_type === "album") {
        const album = await getAlbumInfo(result.id)
        setAlbum(album)
      }

      if (result.item_type === "artist") {
        const artist = await getArtistInfo(result.id)
        setArtist(artist)
      }
    }

    fetchInfo()
  }, [result.id, result.item_type])

const coverUrl = result.item_type === "song" 
  ? song?.album_object.cover_url 
  : result.item_type === "album" 
  ? album?.cover_url 
  : result.item_type === "artist" 
  ? artist?.icon_url 
  : "";

  const imageSrc = `${getBaseURL()}/image/${encodeURIComponent(coverUrl || "")}?raw=true`;

    if (result.item_type === 'song' && song) {
      return (
        <div key={result.id} className="relative flex flex-col items-center p-14" style={{ height: 350, width: 500 }}>
          <Image
            className="bg-cover bg-center blur-3xl"
            src={imageSrc}
            alt="Background Image"
            height={1000}
            width={1000}
            style={{
              backgroundColor: "#202020",
              transition: "background background-color 0.5s ease",
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              filter: 'blur(10px) brightness(50%)',
              zIndex: "10"
            }}
          />
          <div className="relative z-10">
            <SongCard
              song_name={song.name}
              song_id={song.id}
              path={song.path}
              artist_id={song.artist_object.id}
              artist_name={song.artist}
              album_id={song.album_object.id}
              album_name={song.album_object.name}
              album_cover={song.album_object.cover_url ?? ""}
            />
          </div>
        </div>
      );
    } else if (result.item_type === 'artist' && artist) {
      return (
        <div key={result.id} className="relative flex flex-col items-center p-14" style={{ height: 350, width: 500 }}>
          <Image
            className="bg-cover bg-center blur-3xl"
            src={imageSrc}
            alt="Background Image"
            height={1000}
            width={1000}
            style={{
              backgroundColor: "#202020",
              transition: "background background-color 0.5s ease",
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              filter: 'blur(10px) brightness(50%)',
              zIndex: "10"
            }}
          />
          <div className="relative z-10">
            <ArtistCard artist={artist} />
          </div>
        </div>
      );
    } else if (result.item_type === 'album' && album) {
      return (
        <div key={result.id} className="relative flex flex-col items-center p-14 h-14 w-14" style={{ height: 350, width: 500 }}>
          <Image
            className="bg-cover bg-center blur-3xl"
            src={imageSrc}
            alt="Background Image"
            height={1000}
            width={1000}
            style={{
              backgroundColor: "#202020",
              transition: "background background-color 0.5s ease",
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              filter: 'blur(10px) brightness(50%)',
              zIndex: "10"
            }}
          />
          <div className="relative z-10">
            <AlbumCard 
              artist_id={album.artist_object.id}
              artist_name={album.artist_object.name}
              album_id={album.id}
              album_name={album.name}
              album_cover={album.cover_url}
              album_songs_count={album.songs.length}
              first_release_date={album.first_release_date}
            />
          </div>
        </div>
      );
    }
}
