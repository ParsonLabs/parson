"use client"

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRandomArtist } from "@music/sdk";
import { Artist } from "@music/sdk/types";
import ScrollButtons from "./ScrollButtons";
import getBaseURL from "@/lib/Server/getBaseURL";
import Link from "next/link";
import Image from "next/image";

async function getTopArtists(limit: number = 10): Promise<Artist[]> {
  try {
    const artists = await getRandomArtist(limit);
    return artists;
  } catch (err) {
    console.error("Error fetching top artists:", err);
    return [];
  }
}

interface TopArtistsProps {
  limit?: number;
}

export default function TopArtists({ limit = 10 }: TopArtistsProps) {
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ['topArtists', limit],
    queryFn: () => getTopArtists(limit),
    staleTime: 3 * 60 * 60 * 1000,
  });

  if (isLoading) return (
    <ScrollButtons heading="Top Artists" id="TopArtists">
      <div className="flex flex-row pb-14 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div className="mr-20 flex flex-col items-center" key={i}>
            <div className="w-40 h-40 bg-gray-800 rounded-full"></div>
            <div className="w-32 h-4 mt-4 bg-gray-800 rounded"></div>
            <div className="w-24 h-3 mt-2 bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>
    </ScrollButtons>
  );

  if (!artists || artists.length === 0) return null;

  return (
    <ScrollButtons heading="Top Artists" id="TopArtists">
      <div className="flex flex-row pb-14">
        {artists.map((artist) => (
          <Link
            href={`/artist/${artist.id}`}
            key={`artist-${artist.id}`}
            className="mr-20 flex flex-col items-center group"
          >
            <div className="w-40 h-40 rounded-full overflow-hidden mb-3 group-hover:shadow-lg group-hover:shadow-indigo-500/30 transition-shadow duration-300">
              {artist.icon_url ? (
                <Image
                  src={artist.icon_url .startsWith('http') ? 
                    artist.icon_url: 
                    `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}`
                  }
                  alt={artist.name}
                  className="w-full h-full object-cover"
                  width={100}
                  height={100}
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center">
                  <span className="text-4xl text-gray-400">{artist.name.charAt(0)}</span>
                </div>
              )}
            </div>
            <h3 className="text-lg font-medium text-white group-hover:text-indigo-400 transition-colors duration-300">{artist.name}</h3>
            {artist.albums?.[0]?.songs?.length && (
              <p className="text-sm text-gray-400">{artist.albums?.[0]?.songs?.length} songs</p>
            )}
          </Link>
        ))}
      </div>
    </ScrollButtons>
  );
}