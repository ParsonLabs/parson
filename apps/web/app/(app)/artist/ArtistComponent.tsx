"use client"
import getBaseURL from "@/lib/Server/getBaseURL";

import SongsInLibrary from "@/components/Artist/SongsInLibrary";
import Description from "@/components/Description/Description";
import ScrollButtons from "@/components/Home/ScrollButtons";
import PageGradient from "@/components/Layout/PageGradient";
import AlbumCard from "@/components/Music/Card/Album/AlbumCard";
import BigCard from "@/components/Music/Card/BigCard";
import { getArtistInfo } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

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
    return
  }

  const artistIconURL = artist.icon_url.length === 0 ? "/snf.png" : `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}?raw=true`;

  return (
    <>
      <div
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 100%), url(${artistIconURL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          height: "500px",
        }}
        >
        <PageGradient imageSrc={artistIconURL} />
        <div className="flex flex-col justify-center items-center gap-8 pt-32">
          <h1 className="text-8xl font-extrabold">{artist.name}</h1>
          <h1 className="text-2xl">{formatFollowers(artist.followers)} Followers</h1>
        </div>
      </div>
      <div className="mx-52">
        <Description description={artist.description} />
      </div>

      <ScrollButtons heading="Songs">
        <div className="flex flex-row justify-center items-start">
          {randomSongs.map((song, index) => (
            <div key={index} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 p-8">
               <BigCard
                 title={song.name}
                 album={song.album_object}
                 artist={song.artist_object}
                 imageSrc={
                   song.album_object.cover_url.length === 0
                   ? "/snf.png"
                   : `${getBaseURL()}/image/${encodeURIComponent(song.album_object.cover_url)}`
                 }
                 albumURL=""
                 songURL={`${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=0`}
                 type="Song"
                 song={song}
                 />
            </div>
          ))}
        </div>
      </ScrollButtons>

      <ScrollButtons heading="Albums">
        <div className="flex flex-row items-start">
          {albums
            .sort((a: Album, b: Album) => {
              const dateA = new Date(a.first_release_date).getTime();
              const dateB = new Date(b.first_release_date).getTime();
        
              if (isNaN(dateA)) return 1;
              if (isNaN(dateB)) return -1;
        
              return dateB - dateA;
            })
            .map((album: Album, index: number) => (
              <div key={index} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 p-8">
                <AlbumCard artist={artist} album={album} />
              </div>
            ))}
        </div>
      </ScrollButtons>

      <Suspense>
        <SongsInLibrary />
      </Suspense>

      <div className="pb-48" />
    </>
  );
}
