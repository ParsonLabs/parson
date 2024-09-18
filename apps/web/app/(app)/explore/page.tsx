"use client";

import { getAlbumsByGenres, listAllGenres, getAlbumInfo } from "@music/sdk";
import { useEffect, useState } from "react";
import { Card, CardTitle } from "@music/ui/components/card";
import { Album, Artist } from "@music/sdk/types";
import Image from "next/image";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import AlbumCard from "@/components/Music/Card/Album/AlbumCard";

export type LibraryAlbum = Album & { artist_object: Artist };

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

export default function ExplorePage() {
  const [genres, setGenres] = useState<string[]>([]);
  const [albums, setAlbums] = useState<{ [key: string]: Album[] }>({});
  const [backgroundColors, setBackgroundColors] = useState<{ [key: string]: string }>({});
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [albumDetails, setAlbumDetails] = useState<{ [key: string]: LibraryAlbum }>({});

  useEffect(() => {
    async function fetchGenresAndAlbums() {
      const genreList = await listAllGenres();
      setGenres(genreList);

      const albumsByGenres = await getAlbumsByGenres(genreList);
      const albumsMap: { [key: string]: Album[] } = {};
      albumsByGenres.forEach((album) => {
        const genres = album.release_group_album?.genres || album.release_album?.genres;
        genres?.forEach((genre) => {
          if (!albumsMap[genre.name]) {
            albumsMap[genre.name] = [];
          }
          albumsMap[genre.name]?.push(album);
        });
      });
      setAlbums(albumsMap);

      const fac = new FastAverageColor();
      const colorsMap: { [key: string]: string } = {};
      for (const genre of genreList) {
        if (albumsMap[genre] && albumsMap[genre][0]) {
          const imageSrc = albumsMap[genre][0].cover_url.length === 0
            ? "/snf.png"
            : `${getBaseURL()}/image/${encodeURIComponent(albumsMap[genre][0].cover_url)}`;
          const color = await fac.getColorAsync(imageSrc);
          colorsMap[genre] = color.hex;
        }
      }
      setBackgroundColors(colorsMap);
    }
    fetchGenresAndAlbums();
  }, []);

  useEffect(() => {
    async function fetchAlbumDetails() {
      if (selectedGenre) {
        const genreAlbums = albums[selectedGenre];
        const albumDetailsMap: { [key: string]: LibraryAlbum } = {};

        if (genreAlbums) {
          const albumDetailsPromises = genreAlbums.map(async (album) => {
            const albumInfo = await getAlbumInfo(album.id);
            albumDetailsMap[album.id] = albumInfo as LibraryAlbum;
          });

          await Promise.all(albumDetailsPromises);
          setAlbumDetails(albumDetailsMap);
        }
      }
    }
    fetchAlbumDetails();
  }, [selectedGenre, albums]);

  const resetSelection = () => {
    setSelectedGenre(null);
  };

  if (selectedGenre) {
    return (
      <div className="pt-32 z-10 relative">
        <h1 className="font-bold text-lg md:text-3xl lg:text-4xl mr-5">
          <div
            onClick={(e) => {
              e.preventDefault();
              resetSelection();
            }}
            className="cursor-pointer"
            style={{ zIndex: 20, position: 'relative' }}
          >
            {capitalizeWords(selectedGenre)} Albums
          </div>
        </h1>
        <div className="pt-10 flex flex-wrap -mx-2">
          {albums[selectedGenre]?.map((album) => (
            <div key={album.id} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 px-2 mb-4 py-16">
              {albumDetails[album.id] ? (
                <AlbumCard
                  artist_id={albumDetails[album.id]?.artist_object?.id ?? ""}
                  artist_name={albumDetails[album.id]?.artist_object?.name ?? ""}
                  album_id={albumDetails[album.id]?.id ?? ""}
                  album_name={albumDetails[album.id]?.name ?? ""}
                  album_cover={albumDetails[album.id]?.cover_url ?? ""}
                  first_release_date={albumDetails[album.id]?.first_release_date ?? ""}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="pt-28 font-bold text-lg md:text-3xl lg:text-4xl mr-5">Browse All</h1>
      <div className="pt-12 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 overflow-hidden">
        {genres.map((genre) => (
          <button
            key={genre}
            className="relative flex items-center justify-center overflow-hidden w-full h-40 rounded-lg"
            style={{
              backgroundColor: backgroundColors[genre] || 'transparent',
            }}
            onClick={() => setSelectedGenre(genre)}
          >
            <div className="absolute top-2 left-2">
              <CardTitle className="text-xl font-bold">{capitalizeWords(genre)}</CardTitle>
            </div>
            {albums[genre] && albums[genre][0] && (
              <Image
                src={
                  albums[genre][0].cover_url.length === 0
                    ? "/snf.png"
                    : `${getBaseURL()}/image/${encodeURIComponent(albums[genre][0].cover_url)}`
                }
                height={125}
                width={125}
                alt={albums[genre][0].name}
                className="absolute bottom-0 right-0 shadow-lg rounded-sm"
                style={{
                  transform: 'rotate(35deg) translateX(25%)',
                }}
              />
            )}
          </button>
        ))}
      </div>
    </>
  );
}