import getBaseURL from "@/lib/Server/getBaseURL";
import { getAlbumInfo, getArtistInfo, getSongInfo, LibraryAlbum } from '@music/sdk';
import { Artist, CombinedItem, LibrarySong } from '@music/sdk/types';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Pause, Play, ExternalLink, Clock, Music, User, Disc } from 'lucide-react';
import Link from 'next/link';
import { usePlayer } from '../../Player/usePlayer';
import { useSession } from '@/components/Providers/AuthProvider';
import { motion } from 'framer-motion';

type ResultCardProps = {
  result: CombinedItem 
}

export default function TopResultsCard({ result }: ResultCardProps) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [song, setSong] = useState<LibrarySong | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const {
    setImageSrc,
    setAudioSource,
    setSong: setPlayerSong,
    setArtist: setPlayerArtist,
    setAlbum: setPlayerAlbum,
    setPlayedFromAlbum,
    song: playingSong,
    isPlaying,
    togglePlayPause,
    playAudioSource
  } = usePlayer();

  const playingSongID = playingSong?.id;
  const { session } = useSession();

  useEffect(() => {
    async function fetchInfo() {
      if (result.item_type === "song") {
        const song = await getSongInfo(result.id, false) as LibrarySong;
        setSong(song);
      }

      if (result.item_type === "album") {
        const album = await getAlbumInfo(result.id, false) as LibraryAlbum;
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
      result += `${hours}h `;
    }
    if (minutes > 0 || hours > 0) {
      result += `${minutes}m`;
    } else if (seconds > 0) {
      result += `${seconds}s`;
    }
    return result.trim();
  }

  async function handlePlay() {
    if (!song) return;
    
    const albumCoverURL =
      song.album_object.cover_url.length === 0
        ? "/snf.png"
        : `${getBaseURL()}/image/${encodeURIComponent(song.album_object.cover_url)}?raw=true`;
        
    console.log("first song", song)
    setImageSrc(albumCoverURL);
    setPlayerSong(song)
    setPlayerArtist(song.artist_object);
    setPlayerAlbum(song.album_object);
    const songURL = `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${(session && session.bitrate) || 0}`;
    setAudioSource(songURL);

    console.log(songURL)
    setPlayedFromAlbum(false);
    playAudioSource()
  }

  const getNavigationLink = () => {
    if (result.item_type === "album" && album) {
      return `/album?id=${album.id}`;
    } else if (result.item_type === "artist" && artist) {
      return `/artist?id=${artist.id}`;
    } else if (result.item_type === "song" && song) {
      return `/album?id=${song.album_object.id}`;
    }
    return '#';
  };

  const getTypeIcon = () => {
    switch (result.item_type) {
      case "song": return <Music className="w-4 h-4" />;
      case "album": return <Disc className="w-4 h-4" />;
      case "artist": return <User className="w-4 h-4" />;
      default: return null;
    }
  };

  const isActiveTrack = playingSongID === song?.id;

  return (
    <Link href={getNavigationLink()}>
      <motion.div 
        className="relative w-full rounded-xl overflow-hidden bg-gradient-to-br from-black/80 to-black/60 backdrop-blur-md border border-white/5 shadow-xl"
        whileHover={{ scale: 1.01 }}
        onHoverStart={() => setIsHovered(true)}
        onHoverEnd={() => setIsHovered(false)}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-20"
          style={{
            backgroundImage: `url(${imageSrc})`,
            filter: 'blur(100px)',
          }}
        />
        
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-blue-500 to-indigo-500 opacity-80" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-purple-500/20 blur-xl" />
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-blue-500/20 blur-xl" />

        <div className="relative z-10 flex flex-col md:flex-row items-center p-6 md:p-8 gap-6 md:gap-8">
          <motion.div 
            className="relative flex-shrink-0"
            animate={{ 
              rotateY: isHovered ? 5 : 0,
              rotateX: isHovered ? -5 : 0
            }}
            transition={{ type: "spring", stiffness: 100 }}
          >
            <div className={`relative w-48 md:w-[200px] aspect-square shadow-2xl ${
              result.item_type === "artist" ? "rounded-full overflow-hidden" : "rounded-lg overflow-hidden"
            }`}>
              <div className="absolute top-3 left-3 z-20 bg-black/70 backdrop-blur-md text-xs font-medium py-1 px-2 rounded-full flex items-center gap-1 text-white/90">
                {getTypeIcon()}
                <span className="capitalize">{result.item_type}</span>
              </div>
              
              <Image
                src={imageSrc}
                alt={result.name}
                fill
                className={`object-cover transition-all duration-300 ${isHovered ? "brightness-110 scale-105" : "brightness-100 scale-100"}`}
                priority
                sizes="(max-width: 768px) 192px, 200px"
              />
              
              {result.item_type === "song" && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: isHovered || isActiveTrack ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                  onClick={(e) => {
                    e.preventDefault();
                    handlePlay();
                  }}
                  className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/80 via-black/40 to-transparent"
                  aria-label={isActiveTrack && isPlaying ? "Pause song" : "Play song"}
                >
                  <div className="bg-white rounded-full p-4 shadow-lg transform transition-transform hover:scale-105 active:scale-95">
                    {isActiveTrack && isPlaying ? (
                      <Pause className="w-10 h-10 text-black fill-black" />
                    ) : (
                      <Play className="w-10 h-10 text-black fill-black ml-1" />
                    )}
                  </div>
                </motion.button>
              )}
            </div>
          </motion.div>

          <div className="flex flex-col justify-center text-center md:text-left w-full">
            <motion.h1 
              className="text-3xl md:text-4xl font-bold mb-3 text-white bg-gradient-to-r from-white via-white to-purple-200 bg-clip-text text-transparent"
              animate={{ opacity: [0.9, 1], y: isHovered ? -2 : 0 }}
              transition={{ duration: 0.3 }}
            >
              {result.name}
            </motion.h1>
            
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm text-gray-300 mb-5 font-medium">
              {result.item_type === "song" && song && (
                <>
                  <span className="px-2 py-1 bg-white/10 rounded-full flex items-center gap-1">
                    <Music className="w-3.5 h-3.5" />
                    <span>Song</span>
                  </span>
                  <span className="text-white/40">•</span>
                  <Link href={`/artist?id=${song.artist_object.id}`} className="hover:text-white transition-colors">
                    {song.artist}
                  </Link>
                  <span className="text-white/40">•</span>
                  <Link href={`/album?id=${song.album_object.id}`} className="hover:text-white transition-colors">
                    {song.album_object.name}
                  </Link>
                  <span className="text-white/40">•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatDuration(song.duration)}
                  </span>
                </>
              )}
              
              {result.item_type === "album" && album && (
                <>
                  <span className="px-2 py-1 bg-white/10 rounded-full flex items-center gap-1">
                    <Disc className="w-3.5 h-3.5" />
                    <span>Album</span>
                  </span>
                  <span className="text-white/40">•</span>
                  <Link href={`/artist?id=${album.artist_object.id}`} className="hover:text-white transition-colors">
                    {album.artist_object.name}
                  </Link>
                  <span className="text-white/40">•</span>
                  <span className="flex items-center gap-1">
                    <Music className="w-3.5 h-3.5" />
                    {album.songs.length} {album.songs.length === 1 ? 'Song' : 'Songs'}
                  </span>
                </>
              )}
              
              {result.item_type === "artist" && artist && (
                <>
                  <span className="px-2 py-1 bg-white/10 rounded-full flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    <span>Artist</span>
                  </span>
                  <span className="text-white/40">•</span>
                  <span className="flex items-center gap-1">
                    {artist.followers.toLocaleString()} Followers
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start">
              {result.item_type === "song" && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={(e) => {
                    e.preventDefault();
                    handlePlay();
                  }}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium shadow-lg transition-all hover:shadow-indigo-500/30"
                >
                  {isActiveTrack && isPlaying ? (
                    <Pause className="w-5 h-5 mr-2" />
                  ) : (
                    <Play className="w-5 h-5 mr-2 ml-0.5" />
                  )}
                  {isActiveTrack && isPlaying ? "Pause" : "Play"}
                </motion.button>
              )}
              
              <motion.div 
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center justify-center px-6 py-3 rounded-full border border-white/20 text-white font-medium hover:bg-white/10 transition-all"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                View {result.item_type === "album" ? "Album" : 
                      result.item_type === "artist" ? "Artist" : "Details"}
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}