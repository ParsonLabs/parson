"use client";

import Description from "@/components/Description/Description";
import AlbumTable from "@/components/Music/Album/AlbumTable";
import getBaseURL from "@/lib/Server/getBaseURL";
import AllmusicLogo from "@/public/AllmusicLogo.png";
import BBCLogo from "@/public/BBCLogo.svg";
import DiscogsLogo from "@/public/discogs_icon.png";
import MusicbrainzLogo from "@/public/musicbrainz_icon.png";
import PitchforkLogo from "@/public/PitchforkLogo.png";
import RateyourmusicLogo from "@/public/RateyourmusicLogo.png";
import WikidataLogo from "@/public/wikidata_logo.png";
import WikipediaLogo from "@/public/wikipedia_logo.png";
import { getAlbumInfo, getArtistInfo, LibraryAlbum } from "@music/sdk";
import { Artist } from "@music/sdk/types";
import { Badge } from "@music/ui/components/badge";
import { Button } from "@music/ui/components/button";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  Clock,
  Music,
  CalendarIcon,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { usePlayer } from "@/components/Music/Player/usePlayer";
import { useSession } from "@/components/Providers/AuthProvider";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import { Video } from "lucide-react";
import MusicVideoCard from "@/components/Music/Card/MusicVideoCard";

const getRelationshipIcon = (url: string) => {
  switch (true) {
    case url.includes("discogs"):
      return { src: DiscogsLogo, alt: "Discogs Logo" };
    case url.includes("wikidata"):
      return { src: WikidataLogo, alt: "Wikidata Logo" };
    case url.includes("wikipedia"):
      return { src: WikipediaLogo, alt: "Wikipedia Logo" };
    case url.includes("allmusic"):
      return { src: AllmusicLogo, alt: "AllMusic Logo" };
    case url.includes("rateyourmusic"):
      return { src: RateyourmusicLogo, alt: "RateYourMusic Logo" };
    case url.includes("pitchfork"):
      return { src: PitchforkLogo, alt: "Pitchfork Logo" };
    case url.includes("bbc"):
      return { src: BBCLogo, alt: "BBC Logo" };
    default:
      return { src: MusicbrainzLogo, alt: "MusicBrainz Logo" };
  }
};

export default function AlbumComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [album, setAlbum] = useState<LibraryAlbum | null>(null);
  const [artist, setArtist] = useState<Artist | null>(null);
  const [contributingArtists, setContributingArtists] = useState<Artist[]>([]);
  const [musicVideosHovered, setMusicVideosHovered] = useState(false);
  const videosScrollContainerRef = useRef<HTMLDivElement>(null);
  const [showVideosLeftScroll, setShowVideosLeftScroll] = useState(false);
  const [showVideosRightScroll, setShowVideosRightScroll] = useState(false);

  const {
    setImageSrc,
    setSong,
    setAudioSource,
    setArtist: setPlayerArtist,
    setAlbum: setPlayerAlbum,
    isPlaying,
    togglePlayPause,
    song: currentSong,
    playAudioSource,
  } = usePlayer();

  const { session } = useSession();

  const isAlbumPlaying =
    isPlaying && currentSong?.album_object?.id === album?.id;

  const playAlbum = () => {
    if (album?.songs.length === 0) return;

    if (currentSong?.album_object?.id === album?.id) {
      togglePlayPause();
      return;
    }

    const firstSong = album?.songs[0];
    setImageSrc(albumCoverURL);
    setPlayerArtist(artist);
    setPlayerAlbum(album);
    setSong(firstSong);
    if (firstSong?.path) {
      setAudioSource(
        `${getBaseURL()}/api/stream/${encodeURIComponent(firstSong.path)}?bitrate=${session?.bitrate || 0}`
      );
    }
    playAudioSource();
  };

  useEffect(() => {
    if (album?.name && artist?.name) {
      document.title = `${album?.name} by ${artist?.name} | ParsonLabs Music`;
    }

    return () => {
      document.title = "ParsonLabs Music";
    };
  }, [album, artist]);

  useEffect(() => {
    if (!id || typeof id !== "string") return;

    const fetchAlbumInfo = async () => {
      const album = (await getAlbumInfo(id, false)) as LibraryAlbum;

      const artistData = album.artist_object;
      const contributingArtistIds = album.contributing_artists_ids;

      if (contributingArtistIds) {
        const contributingArtistsPromises = contributingArtistIds.map(
          (artistId) => getArtistInfo(artistId)
        );

        const contributingArtistsData = await Promise.all(
          contributingArtistsPromises
        );
        setContributingArtists(contributingArtistsData);
      } else {
        setContributingArtists([]);
      }

      setAlbum(album);
      setArtist(artistData);
    };

    fetchAlbumInfo();
  }, [id]);

  useEffect(() => {
      const scrollContainer = videosScrollContainerRef.current;
  
      const handleScroll = () => {
        if (scrollContainer) {
          const { scrollLeft, scrollWidth, clientWidth } = scrollContainer;
          setShowVideosLeftScroll(scrollLeft > 0);
          setShowVideosRightScroll(scrollLeft + clientWidth < scrollWidth);
        }
      };
  
      if (scrollContainer) {
        scrollContainer.addEventListener("scroll", handleScroll);
        handleScroll();
      }
  
      return () => {
        if (scrollContainer) {
          scrollContainer.removeEventListener("scroll", handleScroll);
        }
      };
    }, []);

  const handleVideosScrollLeft = () => {
    if (videosScrollContainerRef.current) {
      videosScrollContainerRef.current.scrollBy({
        left: -300,
        behavior: "smooth",
      });
    }
  };

  const handleVideosScrollRight = () => {
    if (videosScrollContainerRef.current) {
      videosScrollContainerRef.current.scrollBy({
        left: 300,
        behavior: "smooth",
      });
    }
  };

  if (!album || !artist) {
    return null;
  }

  const albumCoverURL =
    album.cover_url.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}?raw=true`;

  const artistIconURL =
    artist.icon_url.length === 0
      ? "/snf.png"
      : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}?raw=true`;

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

  let totalDuration = album.songs.reduce(
    (total, song) => total + song.duration,
    0
  );

  let releaseDate = "";
  if (
    album.first_release_date &&
    !isNaN(new Date(album.first_release_date).getTime())
  ) {
    releaseDate = new Date(album.first_release_date).toLocaleString("default", {
      month: "long",
      year: "numeric",
    });
  }

  const genres = [
    ...(album.release_group_album?.genres || []),
    ...(album.release_album?.genres || []),
  ];
  const relationships = [
    ...(album.release_group_album?.relationships || []),
    ...(album.release_album?.relationships || []),
  ];

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />

      <div
        className="fixed inset-0 opacity-30 will-change-transform"
        style={{
          backgroundImage: `url(${albumCoverURL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(140px)",
          transform: "translateZ(0)",
        }}
      />

      <div className="fixed top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/80 to-transparent z-0" />

      <div className="fixed bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-black/80 to-transparent z-0" />

      <div className="relative z-10 px-4 md:px-8 pt-20 pb-28 backdrop-blur-sm">
        <div className="max-w-8xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col md:flex-row items-center md:items-start gap-8 mb-10"
          >
            <div className="flex-shrink-0 flex justify-center md:justify-start">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="relative w-64 md:w-[300px] aspect-square shadow-2xl group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-lg" />

                <Image
                  src={albumCoverURL}
                  alt={`${album.name} Cover`}
                  layout="fill"
                  className="rounded-lg object-cover"
                  priority
                />

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={playAlbum}
                  className="absolute bottom-4 right-4 bg-white rounded-full p-3 shadow-lg opacity-0 group-hover:opacity-100 transition-all duration-300"
                  aria-label={isAlbumPlaying ? "Pause album" : "Play album"}
                >
                  {isAlbumPlaying ? (
                    <Pause className="w-8 h-8 text-black" />
                  ) : (
                    <Play className="w-8 h-8 text-black ml-1" />
                  )}
                </motion.button>
              </motion.div>
            </div>

            <div className="flex flex-col justify-end text-center md:text-left max-w-2xl">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <div className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Album
                </div>
                <h1 className="text-4xl md:text-7xl font-bold mb-4 text-white bg-gradient-to-r from-white via-white to-purple-200 bg-clip-text text-transparent">
                  {album.name}
                </h1>

                <div className="flex items-center justify-center md:justify-start gap-3 mb-5">
                  <Link href={`/artist?id=${artist.id}`}>
                    <div className="flex items-center hover:opacity-80 transition bg-white/10 px-3 py-2 rounded-full">
                      <Image
                        src={artistIconURL}
                        width={32}
                        height={32}
                        alt={artist.name}
                        className="rounded-full"
                      />
                      <span className="ml-2 text-lg text-white font-medium">
                        {artist.name}
                      </span>
                    </div>
                  </Link>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={playAlbum}
                    className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-2.5 rounded-full font-medium hover:shadow-lg transition-all duration-300"
                  >
                    {isAlbumPlaying ? (
                      <>
                        <Pause className="w-5 h-5" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-5 h-5 ml-0.5" />
                        <span>Play</span>
                      </>
                    )}
                  </motion.button>
                </div>

                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm text-gray-300">
                  {releaseDate && (
                    <div className="flex items-center gap-1.5">
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                      <span>{releaseDate}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Music className="w-4 h-4 text-gray-400" />
                    <span>{album.songs.length} Songs</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span>{formatDuration(totalDuration)}</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,320px] gap-8">
            <div className="flex flex-col space-y-6">
              {album.songs.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                  className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5"
                >
                  <h2 className="text-xl font-semibold mb-4 text-white">Songs</h2>
                  <AlbumTable
                    album={album}
                    songs={album.songs}
                    artist={artist}
                    key={album.id}
                  />
                </motion.div>
              )}
            </div>
            
            <div className="space-y-6">
              {genres.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.4 }}
                  className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5"
                >
                  <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                    Genres
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {genres.map((tag, index) => (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                          duration: 0.3,
                          delay: 0.4 + index * 0.05,
                        }}
                        key={tag.name}
                      >
                        <Badge
                          variant="secondary"
                          className="bg-white/10 hover:bg-white/20 transition-all px-3 py-1 text-sm font-medium"
                        >
                          {tag.name}
                        </Badge>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {relationships.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.5 }}
                  className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5"
                >
                  <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                    Links
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {relationships.map((relationship, index) => {
                      const icon = getRelationshipIcon(relationship.url);
                      return (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{
                            duration: 0.3,
                            delay: 0.5 + index * 0.05,
                          }}
                          key={relationship.musicbrainz_id}
                        >
                          <Link
                            href={relationship.url}
                            target="_blank"
                            className="block transition-transform hover:scale-110"
                          >
                            <div className="bg-white/10 rounded-full p-2 hover:bg-white/20 transition-all">
                              <Image
                                src={icon.src}
                                alt={icon.alt}
                                width={24}
                                height={24}
                                className="w-6 h-6"
                              />
                            </div>
                          </Link>
                        </motion.div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {contributingArtists.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.6 }}
                  className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5"
                >
                  <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                    Featured Artists
                  </h3>
                  <div className="space-y-3">
                    {contributingArtists.map((artist, index) => (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.3,
                          delay: 0.6 + index * 0.05,
                        }}
                        key={artist.id}
                      >
                        <Link href={`/artist/?id=${artist.id}`}>
                          <div className="flex items-center gap-3 hover:bg-white/10 p-3 rounded-lg transition-all hover:transform hover:translate-x-1">
                            <Image
                              src={
                                artist.icon_url.length === 0
                                  ? "/snf.png"
                                  : `${getBaseURL()}/image/${encodeURIComponent(
                                      artist.icon_url
                                    )}?raw=true`
                              }
                              alt={artist.name}
                              height={44}
                              width={44}
                              className="rounded-full object-cover"
                            />
                            <div>
                              <span className="text-gray-100 font-medium">
                                {artist.name}
                              </span>
                              <p className="text-xs text-gray-400">Artist</p>
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {album.description && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.7 }}
                  className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5"
                >
                  <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
                    <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                    About
                  </h3>
                  <div className="prose prose-invert prose-sm max-w-none">
                    <div>
                      <Description description={album.description} />
                    </div>
                  </div>
                </motion.div>
              )}
              
              {!genres.length && !relationships.length && !contributingArtists.length && !album.description && (
                <div className="hidden lg:block h-0"></div>
              )}
            </div>
          </div>

          {album.songs.some((song) => song.music_video) && (
            <motion.div
              className="relative pb-8 mt-16 w-full max-w-full overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.8 }}
              onMouseEnter={() => setMusicVideosHovered(true)}
              onMouseLeave={() => setMusicVideosHovered(false)}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/30 to-black/50 -mx-4 md:-mx-8"></div>
          
              <div className="relative flex items-end justify-between mb-6 px-2 z-10">
                <div>
                  <motion.div
                    className="text-xs font-semibold tracking-wider text-gray-300 mb-2 flex items-center"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span className="mr-2 bg-white/10 px-2 py-1 rounded-full backdrop-blur-sm">
                      FROM THIS ALBUM
                    </span>
                  </motion.div>
          
                  <motion.h2
                    className="text-2xl md:text-3xl font-bold text-white flex items-center"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                  >
                    <span className="relative">
                      Music Videos
                      <span className="absolute -bottom-1 left-0 w-full h-[2px] bg-gradient-to-r from-purple-500 to-blue-500"></span>
                    </span>
                    <span className="ml-3 text-sm bg-white/10 px-2.5 py-1 rounded-full text-gray-300">
                      {album.songs.filter((song) => song.music_video).length}
                    </span>
                  </motion.h2>
                </div>
              </div>
          
              <div className="relative z-10">
                <AnimatePresence>
                  {showVideosLeftScroll && musicVideosHovered && (
                    <motion.button
                      className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
                      onClick={handleVideosScrollLeft}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <ArrowLeft size={20} />
                    </motion.button>
                  )}
                </AnimatePresence>
          
                <AnimatePresence>
                  {showVideosRightScroll && musicVideosHovered && (
                    <motion.button
                      className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white backdrop-blur-sm border border-white/10 hover:bg-black/80 transition-all shadow-lg shadow-black/30"
                      onClick={handleVideosScrollRight}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <ArrowRight size={20} />
                    </motion.button>
                  )}
                </AnimatePresence>
          
                <div
                  ref={videosScrollContainerRef}
                  className="flex overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-6 px-2"
                  style={{ scrollbarWidth: "none" }}
                >
                  {album.songs
                    .filter((song) => song.music_video)
                    .map((song, index) => (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.4,
                          delay: index * 0.06,
                          ease: [0.23, 1, 0.32, 1],
                        }}
                        whileHover={{
                          y: -12,
                          transition: { duration: 0.2 },
                        }}
                        className="snap-start shrink-0 pl-6 pr-2 w-[360px] group"
                        key={`${song.id}-video-${index}`}
                      >
                        <div className="relative overflow-hidden rounded-xl shadow-xl shadow-black/40 transition-all duration-300 group-hover:shadow-2xl group-hover:shadow-purple-900/20">
                          <MusicVideoCard song={song} />
                        </div>
                      </motion.div>
                    ))}
                </div>
          
                <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-black to-transparent pointer-events-none z-10" />
                <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-black to-transparent pointer-events-none z-10" />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

const renderStars = (rating: number) => {
  const fullStars = Math.floor(rating);
  const halfStar = rating % 1 >= 0.5 ? 1 : 0;
  const emptyStars = 5 - fullStars - halfStar;

  return (
    <>
      {"★".repeat(fullStars)}
      {halfStar ? "☆" : ""}
      {"☆".repeat(emptyStars)}
    </>
  );
};
