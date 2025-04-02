"use client"

import { memo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRandomAlbum } from "@music/sdk";
import { LibraryAlbum } from "@music/sdk";
import AlbumCard from "../Music/Card/Album/AlbumCard";
import ScrollButtons from "./ScrollButtons";

const MemoizedAlbumCard = memo(AlbumCard);

async function getRecentlyAddedAlbums(limit: number = 10): Promise<LibraryAlbum[]> {
  try {
    const albums = await getRandomAlbum(limit * 3);
    
    const uniqueAlbums = new Map<string, LibraryAlbum>();
    
    albums.forEach(album => {
      if (!uniqueAlbums.has(album.id)) {
        uniqueAlbums.set(album.id, album);
      }
    });
    
    return Array.from(uniqueAlbums.values())
      .sort((a, b) => {
        const dateA = new Date(b.first_release_date || 0);
        const dateB = new Date(a.first_release_date || 0);
        return dateA.getTime() - dateB.getTime();
      })
      .slice(0, limit);
  } catch (err) {
    console.error("Error fetching recently added albums:", err);
    return [];
  }
}

interface RecentlyAddedAlbumsProps {
  limit?: number;
}

export default function RecentlyAddedAlbums({ limit = 10 }: RecentlyAddedAlbumsProps) {
  const { data: albums = [], isLoading } = useQuery({
    queryKey: ['recentlyAddedAlbums', limit],
    queryFn: () => getRecentlyAddedAlbums(limit),
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) return (
    <ScrollButtons heading="Recently Added" id="RecentlyAddedAlbums">
      <div className="flex flex-row pb-14 animate-pulse">
        {[...Array(6)].map((_, i) => (
          <div className="mr-20" key={i}>
            <div className="w-40 h-40 bg-gray-800 rounded-md"></div>
            <div className="w-32 h-4 mt-2 bg-gray-800 rounded"></div>
            <div className="w-24 h-3 mt-1 bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>
    </ScrollButtons>
  );

  if (!albums || albums.length === 0) return null;

  return (
    <ScrollButtons heading="Recently Added" id="RecentlyAddedAlbums">
      <div className="flex flex-row pb-20">
        {albums.map((album) => (
          <div className="mr-20" key={`album-${album.id}`}>
            <MemoizedAlbumCard
              artist_id={album.artist_object?.id || ''}
              artist_name={album.artist_object?.name || 'Unknown Artist'}
              album_id={album.id}
              album_name={album.name || 'Unknown Album'}
              album_cover={album.cover_url}
              album_songs_count={album.songs.length || 0}
              first_release_date={album.first_release_date || ''}
            />
          </div>
        ))}
      </div>
    </ScrollButtons>
  );
}