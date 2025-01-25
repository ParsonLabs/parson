"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import getBaseURL from "@/lib/Server/getBaseURL";
import { getRandomAlbum } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import { Skeleton } from "@music/ui/components/skeleton";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FastAverageColor } from 'fast-average-color';

async function getRandomAlbumAndSongs(): Promise<{ album: Album & { artist_object: Artist }, songs: LibrarySong[] }> {
  let album: Album & { artist_object: Artist } | undefined;

  while (!album || !album.cover_url) {
    const randomAlbumRequest = await getRandomAlbum(1);
    album = randomAlbumRequest[0];
  }

  const songs = shuffleSongs(album.songs).slice(0, 3);
  return { album, songs };
}

function shuffleSongs(array: any[]) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }

  for (let i = 2; i < array.length; i++) {
    if (array[i].name === array[i - 1].name && array[i].name === array[i - 2].name) {
      for (let j = i + 1; j < array.length; j++) {
        if (array[j].name !== array[i].name) {
          [array[i], array[j]] = [array[j], array[i]];
          break;
        }
      }
    }
  }

  return array;
}

function sanitizeSongName(songName: string) {
  return songName.replace(/\s+/g, '_').replace(/[^\w-]+/g, '');
}

export function LandingCarouselSkeleton() {
  return (
    <div className="relative p-5 flex items-center" style={{ height: '300px' }}>
      <Skeleton
        className="absolute top-0 left-0 w-full h-full bg-cover bg-center blur-2xl brightness-50"
        style={{ filter: 'blur(12px) brightness(50%)', zIndex: '1', objectFit: 'cover', objectPosition: 'center' }}
      />
      <div className="relative flex-1 flex justify-center" style={{ zIndex: '10' }}>
        <Skeleton
          className="rounded-sm"
          style={{ width: '200px', height: '200px' }}
        />
      </div>
    </div>
  );
}

const AlbumImage = memo(({ src, alt }: { src: string; alt: string }) => (
  <Image
    src={src}
    alt={alt}
    priority={true}
    width={400}
    height={400}
    className="rounded-sm"
    style={{ maxWidth: '200px', maxHeight: '200px' }}
  />
));

const BackgroundImage = memo(({ src, alt }: { src: string; alt: string }) => (
  <Image
    className="absolute top-0 left-0 w-full h-full bg-cover bg-center blur-2xl brightness-50"
    alt={alt}
    width={400}
    height={400}
    role="presentation"
    src={src}
    style={{ filter: 'blur(12px) brightness(50%)', zIndex: '1', objectFit: 'cover', objectPosition: 'center' }}
  />
));

export default function LandingCarousel() {
  const { data, isLoading } = useQuery({
    queryKey: ['landingCarousel'],
    queryFn: getRandomAlbumAndSongs,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const { album, songs } = data || {};

  const albumCoverURL = useMemo(() => {
    if (!album?.cover_url) return '';
    return `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}?raw=true`;
  }, [album?.cover_url]);

  const [buttonColor, setButtonColor] = useState<string>('');

  useEffect(() => {
    if (!albumCoverURL) return;
    const fac = new FastAverageColor();
    fac.getColorAsync(albumCoverURL).then(color => {
      setButtonColor(color.hex);
    });
  }, [albumCoverURL]);

  if (isLoading) return <LandingCarouselSkeleton />;
  if (!album) return null;

  return (
    <div className="relative p-5 flex items-center md:flex" style={{ height: '300px' }}>
      <BackgroundImage src={albumCoverURL} alt={`${album.name} Album Background Image`} />
      
      <div className="relative flex-1 flex justify-center" style={{ zIndex: '10' }}>
        <AlbumImage src={albumCoverURL} alt={`${album.name} Album Cover Image`} />
      </div>

      <div className="relative flex-1 text-center" style={{ zIndex: '10' }}>
        <Link href={`/album?id=${album.id}`}>
          <h2 className="text-xl font-bold">{album.name}</h2>
        </Link>
        <Link href={`/artist?id=${album.artist_object.id}`}>
          <p className="text-base">{album.artist_object.name}</p>
        </Link>
        <Link href={`/album?id=${album.id}`}>
          <Button 
            className="mt-10 px-4 py-2 text-white rounded" 
            style={{ backgroundColor: buttonColor }}
          >
            Play
            <Play className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="relative flex-1" style={{ zIndex: '10' }}>
        <p className="font-bold text-xl">Featuring songs like:</p>
        <ul>
          {songs?.map((song, index) => (
            <li key={`${song.id}-${index}`} className="ml-5">
              <Link href={`/album?id=${album.id}#${sanitizeSongName(song.name)}`}>
                {song.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}