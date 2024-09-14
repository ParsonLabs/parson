"use client"

import getBaseURL from "@/lib/Server/getBaseURL";
import setCache, { getCache } from "@/lib/Caching/cache";
import { getRandomAlbum } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import { Skeleton } from "@music/ui/components/skeleton";
import { Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
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
  )
}

export default function LandingCarousel() {
  const [album, setAlbum] = useState<Album & { artist_object: Artist } | null>(null);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [buttonColor, setButtonColor] = useState<string>('');

  useEffect(() => {
    async function fetchAlbumAndSongs() {
      const cachedData = getCache("landingCarousel");
  
      if (cachedData) {
        setAlbum(cachedData.album);
        setSongs(cachedData.songs);
      } else {
        const { album, songs } = await getRandomAlbumAndSongs();
        setAlbum(album);
        setSongs(songs);
        setCache("landingCarousel", { album, songs }, 86400000);
      }
    }
  
    fetchAlbumAndSongs();
  }, []);

  useEffect(() => {
    async function getButtonColour() {
      const albumCoverURL = `${getBaseURL()}/image/${encodeURIComponent(album?.cover_url || "")}?raw=true`
      const fac = new FastAverageColor();
      const color = await fac.getColorAsync(albumCoverURL)
      setButtonColor(color.hex);
    }

    getButtonColour()
  })

  if (!album) return null;

  const albumCoverURL = `${getBaseURL()}/image/${encodeURIComponent(album.cover_url)}?raw=true`;

  return (
    <div className="relative p-5 flex items-center" style={{ height: '300px' }}>
      <Image
        className="absolute top-0 left-0 w-full h-full bg-cover bg-center blur-2xl brightness-50"
        alt={`${album.name} Album Background Image`}
        width={400}
        height={400}
        role="presentation"
        src={albumCoverURL}
        style={{ filter: 'blur(12px) brightness(50%)', zIndex: '1', objectFit: 'cover', objectPosition: 'center' }}
      />
      <div className="relative flex-1 flex justify-center" style={{ zIndex: '10' }}>
        <Image
          src={albumCoverURL}
          alt={`${album.name} Album Cover Image`}
          priority={true}
          width={400}
          height={400}
          className="rounded-sm"
          style={{ maxWidth: '200px', maxHeight: '200px' }}
        />
      </div>
      <div className="relative flex-1 text-center" style={{ zIndex: '10' }}>
        <Link href={`/album?id=${album.id}`}>
          <h2 className="text-xl font-bold">{album.name}</h2>
        </Link>
        <Link href={`/artist?id=${album.artist_object.id}`}>
          <p className="text-base">{album.artist_object.name}</p>
        </Link>
        <Link href={`/album?id=${album.id}`}>
          <Button className="mt-10 px-4 py-2 text-white rounded" style={{ backgroundColor: buttonColor }}>
            Play
            <Play className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </div>
      <div className="relative flex-1" style={{ zIndex: '10' }}>
        <p className="font-bold text-xl">Featuring songs like:</p>
        <ul>
          {songs.map((song, index) => (
            <li key={index} className="ml-5">
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