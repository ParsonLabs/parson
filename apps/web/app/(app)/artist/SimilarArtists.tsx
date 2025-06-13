"use client"

import { getArtistsByGenres } from "@music/sdk";
import { Artist } from "@music/sdk/types";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import getBaseURL from "@/lib/Server/getBaseURL";

type SimilarArtistsProps = {
  artistName: string;
  genres: string[];
};

export default function SimilarArtists({ artistName, genres }: SimilarArtistsProps) {
  const [similarArtists, setSimilarArtists] = useState<Artist[]>([]);

useEffect(() => {
  async function fetchSimilarArtists() {
    if (genres.length === 0) return;
    
    const artists = await getArtistsByGenres(genres);
    const filtered = artists
      .filter(artist => artist.name.toLowerCase().trim() !== artistName.toLowerCase().trim())
      .slice(0, 10);
    
    setSimilarArtists(filtered);
  }

  fetchSimilarArtists();
}, [genres, artistName]);

  if (similarArtists.length === 0) return null;

  return (
    <div className="mb-24 pt-12">
      <h2 className="text-2xl font-bold text-white mb-4">You Might Also Like</h2>
      <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4">
        <ScrollArea className="w-full overflow-x-auto">
          <div className="flex flex-nowrap space-x-4 pb-4">
            {similarArtists.map((artist) => (
              <Link 
                key={artist.id} 
                href={`/artist?id=${artist.id}`}
                className="w-[200px] flex-none group"
              >
                <div className="relative aspect-square mb-3">
                  <Image
                    src={artist.icon_url ? `${getBaseURL()}/image/${encodeURIComponent(artist.icon_url)}?raw=true` : "/snf.png"}
                    alt={artist.name}
                    layout="fill"
                    className="rounded-full object-cover transition-all duration-300 group-hover:brightness-75"
                  />
                </div>
                <div className="text-center">
                  <h3 className="font-medium text-white truncate">{artist.name}</h3>
                  <p className="text-sm text-gray-400">Artist</p>
                </div>
              </Link>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  );
}