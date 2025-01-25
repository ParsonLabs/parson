"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAlbumsByGenres, listAllGenres, getAlbumInfo } from "@music/sdk";
import { Album, Artist } from "@music/sdk/types";
import { useState } from "react";
import { CardTitle } from "@music/ui/components/card";
import Image from "next/image";
import getBaseURL from "@/lib/Server/getBaseURL";
import { FastAverageColor } from "fast-average-color";
import AlbumCard from "@/components/Music/Card/Album/AlbumCard";

export type LibraryAlbum = Album & { artist_object: Artist };

function capitalizeWords(str: string): string {
  return str.replace(/\b\w/g, char => char.toUpperCase());
}

const MemoizedAlbumCard = memo(AlbumCard);
const MemoizedGenreButton = memo(({ genre, backgroundColor, albumCover, onSelect }: {
  genre: string;
  backgroundColor: string;
  albumCover: string;
  onSelect: () => void;
}) => (
  <button
    className="relative flex items-center justify-center overflow-hidden w-full h-40 rounded-lg"
    style={{ backgroundColor }}
    onClick={onSelect}
  >
    <div className="absolute top-2 left-2">
      <CardTitle className="text-xl font-bold">{capitalizeWords(genre)}</CardTitle>
    </div>
    {albumCover && (
      <Image
        src={albumCover}
        height={125}
        width={125}
        alt={genre}
        className="absolute bottom-0 right-0 shadow-lg rounded-sm"
        style={{ transform: 'rotate(35deg) translateX(25%)' }}
      />
    )}
  </button>
));

export default function ExplorePage() {
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);

  const { data: genres = [] } = useQuery({
    queryKey: ['genres'],
    queryFn: listAllGenres,
    staleTime: 24 * 60 * 60 * 1000
  });

  const { data: albumsByGenre = {} } = useQuery({
    queryKey: ['albumsByGenre', genres],
    queryFn: () => getAlbumsByGenres(genres),
    staleTime: 60 * 60 * 1000,
    enabled: genres.length > 0,
    select: (data) => {
      const albumsMap: { [key: string]: Album[] } = {};
      data.forEach((album) => {
        const genres = album.release_group_album?.genres || album.release_album?.genres;
        genres?.forEach((genre) => {
          if (!albumsMap[genre.name]) albumsMap[genre.name] = [];
          albumsMap[genre.name]?.push(album);
        });
      });
      return albumsMap;
    }
  });

  const { data: albumDetails = {} } = useQuery({
    queryKey: ['albumDetails', selectedGenre],
    queryFn: async () => {
      if (!selectedGenre || !albumsByGenre[selectedGenre]) return {};
      const details: { [key: string]: LibraryAlbum } = {};
      await Promise.all(
        albumsByGenre[selectedGenre].map(async (album) => {
          details[album.id] = await getAlbumInfo(album.id) as LibraryAlbum;
        })
      );
      return details;
    },
    enabled: !!selectedGenre,
    staleTime: 60 * 60 * 1000
  });

  const { data: backgroundColors = {} } = useQuery({
    queryKey: ['backgroundColors', albumsByGenre],
    queryFn: async () => {
      const fac = new FastAverageColor();
      const colors: { [key: string]: string } = {};
      for (const genre of genres) {
        if (albumsByGenre[genre]?.[0]) {
          const imageSrc = albumsByGenre[genre][0].cover_url || "/snf.png";
          const color = await fac.getColorAsync(
            imageSrc.startsWith('/') ? imageSrc : `${getBaseURL()}/image/${encodeURIComponent(imageSrc)}`
          );
          colors[genre] = color.hex;
        }
      }
      return colors;
    },
    enabled: Object.keys(albumsByGenre).length > 0,
    staleTime: 24 * 60 * 60 * 1000
  });

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
          {albumsByGenre[selectedGenre]?.map((album) => (
            <div key={album.id} className="w-full sm:w-1/2 md:w-1/3 lg:w-1/4 px-2 mb-4 py-16">
              {albumDetails[album.id] ? (
                <MemoizedAlbumCard
                  artist_id={albumDetails[album.id]?.artist_object?.id ?? ""}
                  artist_name={albumDetails[album.id]?.artist_object?.name ?? ""}
                  album_id={albumDetails[album.id]?.id ?? ""}
                  album_name={albumDetails[album.id]?.name ?? ""}
                  album_cover={albumDetails[album.id]?.cover_url ?? ""}
                  album_songs_count={Number(albumDetails[album.id]?.songs.length) ?? ""}
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
          <MemoizedGenreButton
            key={genre}
            genre={genre}
            backgroundColor={backgroundColors[genre] || 'transparent'}
            albumCover={
              albumsByGenre[genre]?.[0]?.cover_url.length === 0
                ? "/snf.png"
                : albumsByGenre[genre]?.[0]?.cover_url
                  ? `${getBaseURL()}/image/${encodeURIComponent(albumsByGenre[genre][0].cover_url)}`
                  : "/snf.png"
            }
            onSelect={() => setSelectedGenre(genre)}
          />
        ))}
      </div>
    </>
  );
}