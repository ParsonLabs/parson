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
    ? song?.album_object?.cover_url
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
    setPlayerAlbum({ id: song?.album_object?.id, name: song?.album_object?.name, cover_url: song?.album_object?.cover_url });
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

  const getNavigationLink = () => {
    if (result.item_type === "album" && album) {
      return `/album?id=${album.id}`;
    } else if (result.item_type === "artist" && artist) {
      return `/artist?id=${artist.id}`;
    }
    return '#';
  };

  return (
    <Link href={getNavigationLink()}>
      <div className="relative w-full rounded-xl overflow-hidden transition-transform duration-200 hover:scale-[1.01] cursor-pointer">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{
            backgroundImage: `url(${imageSrc})`,
            filter: 'blur(140px)',
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row items-center p-8 gap-8">
          <div className="relative flex-shrink-0">
            <div className="relative w-48 md:w-[200px] aspect-square shadow-2xl">
              <Image
                src={imageSrc}
                alt={result.name}
                layout="fill"
                className={`${result.item_type === "artist" ? "rounded-full" : "rounded-lg"} object-cover transition-all duration-300 group-hover:brightness-90`}
                priority
              />
              {result.item_type === "song" && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePlay();
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
                >
                  {playingSongID === song?.id ? (
                    isPlaying ? (
                      <Pause className="w-16 h-16 text-white" fill="white" strokeWidth={0} />
                    ) : (
                      <Play className="w-16 h-16 text-white" fill="white" strokeWidth={0} />
                    )
                  ) : (
                    <Play className="w-16 h-16 text-white" fill="white" strokeWidth={0} />
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center text-center md:text-left">
            <h1 className="text-3xl md:text-5xl font-bold mb-4 text-white">
              {result.name}
            </h1>
            
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-sm text-gray-300 mb-6">
              {result.item_type === "song" && song && (
                <>
                  <span>Song</span>
                  <span>•</span>
                  <Link href={`/artist?id=${song.artist_object.id}`} className="hover:underline">
                    {song.artist}
                  </Link>
                  <span>•</span>
                  <Link href={`/album?id=${song.album_object.id}`} className="hover:underline">
                    {song.album_object.name}
                  </Link>
                  <span>•</span>
                  <span>{formatDuration(song.duration)}</span>
                </>
              )}
              
              {result.item_type === "album" && album && (
                <>
                  <span>Album</span>
                  <span>•</span>
                  <Link href={`/artist?id=${album.artist_object.id}`} className="hover:underline">
                    {album.artist_object.name}
                  </Link>
                  <span>•</span>
                  <span>{album.songs.length} Songs</span>
                </>
              )}
              
              {result.item_type === "artist" && artist && (
                <>
                  <span>Artist</span>
                  <span>•</span>
                  <span>{artist.followers.toLocaleString()} Followers</span>
                </>
              )}
            </div>

            {result.item_type === "song" && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePlay();
                }}
                className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-white text-black font-medium hover:scale-105 transition-transform self-center md:self-start"
              >
                {playingSongID === song?.id && isPlaying ? (
                  <Pause className="w-6 h-6 mr-2" />
                ) : (
                  <Play className="w-6 h-6 mr-2" fill="black" />
                )}
                {playingSongID === song?.id && isPlaying ? "Pause" : "Play"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}