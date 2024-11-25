import getSession from '@/lib/Authentication/JWT/getSession';
import getBaseURL from "@/lib/Server/getBaseURL";
import { getAlbumInfo, getArtistInfo, getSongInfo, LibraryAlbum } from '@music/sdk';
import { Artist, CombinedItem, LibrarySong } from '@music/sdk/types';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';
import ArtistCard from '../../Artist/ArtistCard';
import AlbumCard from '../Album/AlbumCard';
import SongCard from '../SongCard';
import Link from 'next/link';
import { usePlayer } from '../../Player/usePlayer';
import { useSession } from '@/components/Providers/AuthProvider';

type ResultCardProps = {
  result: CombinedItem 
}

export default function TopResultsCard({ result }: ResultCardProps) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [song, setSong] = useState<LibrarySong | null>(null);

  const [isVolumeHovered, setIsVolumeHovered] = useState(false);

  const {
    setImageSrc,
    setAudioSource,
    setSong: setPlayerSong,
    setArtist: setPlayerArtist,
    setAlbum: setPlayerAlbum,
    setPlayedFromAlbum,
    song: playingSong,
    isPlaying,
    volume,
    togglePlayPause,
  } = usePlayer();

  const playingSongID = playingSong?.id;
  const { session } = useSession();

  useEffect(() => {
    async function fetchInfo() {
      if (result.item_type === "song") {
        const song = await getSongInfo(result.id) as LibrarySong;
        setSong(song);
      }

      if (result.item_type === "album") {
        const album = await getAlbumInfo(result.id) as LibraryAlbum;
        setAlbum(album);
      }

      if (result.item_type === "artist") {
        const artist = await getArtistInfo(result.id) as Artist;
        setArtist(artist);
      }
    }

    fetchInfo();
  }, [result.id, result.item_type]);

  const coverUrl = result.item_type === "song"
    ? song?.album_object.cover_url
    : result.item_type === "album"
    ? album?.cover_url
    : result.item_type === "artist"
    ? artist?.icon_url
    : "";

  const imageSrc = `${getBaseURL()}/image/${encodeURIComponent(coverUrl || "")}?raw=true`;

  function formatDuration(duration: number) {
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = Math.round(duration % 60);

    let result = "";
    if (hours > 0) {
      result += `${hours} hr${hours > 1 ? "s" : ""} `;
    }
    if (minutes > 0) {
      result += `${minutes} min${minutes > 1 ? "s" : ""} `;
    }
    return result.trim();
  }

  async function handlePlay() {
    if (!song) return;
    setImageSrc(imageSrc);
    setPlayerArtist({ id: song.artist_object.id, name: song.artist });
    setPlayerAlbum({ id: song.album_object.id, name: song.album_object.name, cover_url: song.album_object.cover_url });
    try {
      const songInfo = await getSongInfo(song.id);
      setPlayerSong(songInfo);
      const songURL = `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${(session && session.bitrate) || 0}`;
      setAudioSource(songURL);
      setPlayedFromAlbum(false);
    } catch (error) {
      console.error("Failed to fetch song info:", error);
    }
  }

  if (result.item_type === 'song' && song) {
    return (
      <div key={result.id} className="relative flex items-center p-12" style={{ height: 400, width: 600 }}>
        <div className="relative z-10 flex items-center p-5 bg-white bg-opacity-30 backdrop-blur-md rounded-lg" style={{ height: '100%', width: '100%' }}>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${imageSrc})`,
              filter: 'blur(80px) brightness(75%)',
              zIndex: "-1"
            }}
          />
          <div className="flex-shrink-0 w-28 h-28 relative">
            <Image
              src={imageSrc}
              alt={song.name + " Image"}
              height={112}
              width={112}
              loading="lazy"
              className="rounded cursor-pointer transition-filter duration-300 hover:brightness-50 object-cover w-full h-full"
              onClick={handlePlay}
            />
            {playingSongID === song.id && (
              <div
                className="absolute inset-0 flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayPause();
                }}
              >
                {volume < 1 ? (
                  isVolumeHovered ? (
                    isPlaying ? (
                      <Pause className="w-10 h-10 text-white" fill="white" strokeWidth={0} />
                    ) : (
                      <Play className="w-10 h-10 text-white" fill="white" strokeWidth={0} />
                    )
                  ) : (
                    <Volume2
                      className="w-10 h-10 text-white"
                      onMouseEnter={() => setIsVolumeHovered(true)}
                      onMouseLeave={() => setIsVolumeHovered(false)}
                    />
                  )
                ) : isPlaying ? (
                  <Pause className="w-10 h-10 text-white" fill="white" strokeWidth={0} />
                ) : (
                  <Play className="w-10 h-10 text-white" fill="white" strokeWidth={0} />
                )}
              </div>
            )}
          </div>
          <div className="ml-5 flex flex-col justify-evenly items-start h-28">
            <h2 className="text-2 xl font-bold">{song.name}</h2>
            <p className="text-md text-gray-400">
              Song • <Link href={`/artist/?id=${song.artist_object.id}`} className="text-gray-400 hover:underline">{song.artist}</Link> • <Link href={`/album/?id=${song.album_object.id}`} className="text-gray-400 hover:underline">{song.album_object.name}</Link> • {formatDuration(song.duration)}
            </p>
            <button className="flex items-center px-3 py-1 bg-white text-black rounded-full" onClick={handlePlay}>
              <Play className="mr-2" size={14} fill="black" strokeWidth={0} /> <p className="text-sm">Play</p>
            </button>
          </div>
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