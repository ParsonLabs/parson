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
      
      <div 
        className="fixed inset-0 opacity-30"
        style={{
          backgroundImage: `url(${artistIconURL})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(140px)',
        }}
      />

      <div className="relative z-10 px-4 md:px-8 pt-8 pb-16">
        <div className="max-w-8xl mx-auto">
          <div className="flex flex-col md:flex-row gap-6 mb-8">
            <div className="flex-shrink-0 flex justify-center md:justify-start">
              <div className="relative w-64 md:w-[300px] aspect-square shadow-2xl">
                <Image
                  src={artistIconURL}
                  alt={artist.name}
                  layout="fill"
                  className="rounded-full object-cover"
                  priority
                />
              </div>
            </div>

            <div className="flex flex-col justify-end text-center md:text-left">
              <h1 className="text-4xl md:text-7xl font-bold mb-4 text-white">
                {artist.name}
              </h1>
              <div className="text-gray-300 text-lg">
                {formatFollowers(artist.followers)} Followers
              </div>
            </div>
          </div>

          {artist.description && (
            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-6 mb-8">
              <Description description={artist.description} />
            </div>
          )}

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">Popular Songs</h2>
            <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4">
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
          </div>

          <ArtistMusicVideos artistName={artist.name} />

          <div>
            <h2 className="text-2xl font-bold text-white mb-4">Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albums
                .sort((a, b) => {
                  const dateA = new Date(a.first_release_date).getTime();
                  const dateB = new Date(b.first_release_date).getTime();
                  if (isNaN(dateA)) return 1;
                  if (isNaN(dateB)) return -1;
                  return dateB - dateA;
                })
                .map((album, index) => (
                  <div key={index}>
                    <ArtistAlbumCard
                      album_id={album.id}
                      album_name={album.name}
                      album_cover={album.cover_url}
                      first_release_date={album.first_release_date}
                    />
                  </div>
                ))}
            </div>
          </div>

          <SimilarArtists 
            artistName={artist.name}
            genres={albums.flatMap(album => 
              [...(album.release_group_album?.genres || []), ...(album.release_album?.genres || [])]
            ).map(g => g.name)}
          />

          <Suspense>
            <SongsInLibrary />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
