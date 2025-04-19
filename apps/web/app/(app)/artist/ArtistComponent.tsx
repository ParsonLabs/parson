"use client"
import getBaseURL from "@/lib/Server/getBaseURL";

import SongsInLibrary from "@/components/Artist/SongsInLibrary";
import Description from "@/components/Description/Description";
import ScrollButtons from "@/components/Home/ScrollButtons";
import PageGradient from "@/components/Layout/PageGradient";
import SongCard from "@/components/Music/Card/SongCard";
import SongRow from "@/components/Music/Card/SongRow";
import { getArtistInfo } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import ArtistMusicVideos from "./ArtistMusicVideos";
import ArtistAlbumCard from "./ArtistAlbumCard";
import SimilarArtists from "./SimilarArtists";
import ArtistSongsInLibrary from "./ArtistSongsInLibrary";
import { motion } from "framer-motion";

export default function ArtistComponent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");

  const [artist, setArtist] = useState<Artist | null>(null);
  const [randomSongs, setRandomSongs] = useState<LibrarySong[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);

  useEffect(() => {
    if (!id || typeof id !== "string") {
      return;
    }

    const fetchData = async () => {
      const artist = await getArtistInfo(id);

      if (!artist) {
        return
      }

      setArtist(artist);
      setAlbums(artist.albums);

      const allSongsData = artist.albums.flatMap((album) =>
        album.songs.map((song) => ({
          ...song,
          artist_object: artist,
          album_object: album,
          album: album.name,
          image: album.cover_url,
        }))
      );

      for (let i = allSongsData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSongsData[i] as any, allSongsData[j] as any] = [allSongsData[j], allSongsData[i]];
      }

      setRandomSongs(allSongsData.slice(0, 20));
    };

    fetchData();
  }, [id]);

  function formatFollowers(followers: number): string {
    if (followers >= 1000000) {
      return (followers / 1000000).toFixed(1) + "M";
    } else if (followers >= 1000) {
      return (followers / 1000).toFixed(1) + "K";
    } else {
      return followers.toString();
    }
  }

  if (!artist) {
    return null;
  }

  const artistIconURL = artist.icon_url.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}?raw=true`;

  return (
    <div className="relative min-h-screen">
      <div className="fixed inset-0 bg-neutral-900" />
      
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ duration: 1.5 }}
        className="fixed inset-0"
        style={{
          backgroundImage: `url(${artistIconURL})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(140px)',
        }}
      />
  
      <div className="relative z-10 px-4 md:px-8 pt-20 pb-16">
        <div className="max-w-8xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col md:flex-row gap-6 mb-12"
          >
            <div className="flex-shrink-0 flex justify-center md:justify-start">
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.8 }}
                className="relative w-64 md:w-[300px] aspect-square shadow-2xl"
              >
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 blur-xl -z-10 transform scale-110" />
                <Image
                  src={artistIconURL}
                  alt={artist.name}
                  layout="fill"
                  className="rounded-full object-cover ring-2 ring-white/10"
                  priority
                />
              </motion.div>
            </div>
  
            <div className="flex flex-col justify-end text-center md:text-left">
              <motion.h1 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="text-4xl md:text-7xl font-bold mb-4 text-white bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300"
              >
                {artist.name}
              </motion.h1>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className="text-gray-300 text-lg font-medium"
              >
                {artist.followers > 0 && `${formatFollowers(artist.followers)} Followers`}
              </motion.div>
            </div>
          </motion.div>
  
          {artist.description && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="bg-black/30 backdrop-blur-md rounded-xl p-6 mb-12 border border-white/5 shadow-xl"
            >
              <Description description={artist.description} />
            </motion.div>
          )}
  
          {randomSongs.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="mb-12"
            >
              <h2 className="text-2xl font-bold mb-4 text-white flex items-center gap-2">
                <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                Popular Songs
              </h2>
              <div className="bg-black/30 backdrop-blur-md rounded-xl p-6 border border-white/5 shadow-xl">
                <div className="space-y-2">
                  {randomSongs.slice(0, 5).map((song, index) => (
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
            </motion.div>
          )}
  
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <ArtistMusicVideos artistName={artist.name} />
          </motion.div>
  
          {albums.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
              className="mb-12"
            >
              <h2 className="text-2xl font-bold mb-4 text-white flex items-center gap-2">
                <span className="w-1.5 h-6 bg-gradient-to-b from-purple-500 to-blue-500 rounded-full inline-block" />
                Albums
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {albums
                  .sort((a, b) => {
                    const dateA = new Date(a.first_release_date).getTime();
                    const dateB = new Date(b.first_release_date).getTime();
                    if (isNaN(dateA)) return 1;
                    if (isNaN(dateB)) return -1;
                    return dateB - dateA;
                  })
                  .map((album, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, delay: 0.1 * Math.min(index, 5) }}
                      whileHover={{ y: -5 }}
                      className="transform transition-all duration-300 hover:shadow-lg"
                    >
                      <ArtistAlbumCard
                        album_id={album.id}
                        album_name={album.name}
                        album_cover={album.cover_url}
                        first_release_date={album.first_release_date}
                      />
                    </motion.div>
                  ))}
              </div>
            </motion.div>
          )}
  
          {albums.some(album => 
            (album.release_group_album?.genres || []).length > 0 ||
            (album.release_album?.genres || []).length > 0
          ) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.8 }}
            >
              <SimilarArtists 
                artistName={artist.name}
                genres={albums.flatMap(album => 
                  [...(album.release_group_album?.genres || []), ...(album.release_album?.genres || [])]
                ).map(g => g.name)}
              />
            </motion.div>
          )}
  
          <Suspense fallback={<div className="h-20 w-full bg-black/20 rounded-xl animate-pulse"></div>}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.9 }}
            >
              <ArtistSongsInLibrary />
            </motion.div>
          </Suspense>
        </div>
      </div>
    </div>
  );
}
