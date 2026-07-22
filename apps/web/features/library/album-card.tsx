"use client";

import { defaultCover } from "@/lib/images/default-cover";
import getBaseURL from "@/lib/api/server-url";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import AlbumMenu from "@/features/library/album-menu";

type AlbumCardProps = {
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover: string;
  first_release_date: string;
};

export default function AlbumCard({
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
}: AlbumCardProps) {
  const albumCoverURL =
    !album_cover || album_cover.length === 0
      ? defaultCover
      : `${getBaseURL()}/media/images/${encodeURIComponent(album_cover)}`;

  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <AlbumMenu album_id={album_id} artist_id={artist_id}>
      <div className="group relative w-full min-w-0">
        <Link
          aria-label={`View ${album_name}`}
          className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          href={`/album?id=${album_id}`}
        />
        <div className="pointer-events-none relative z-[1] aspect-square w-full overflow-hidden rounded-lg bg-[#111]">
          {!imageLoaded && (
            <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />
          )}
          <Image
            src={albumCoverURL}
            alt={`${album_name} cover`}
            height={800}
            width={800}
            onLoad={() => setImageLoaded(true)}
            onError={(event) => {
              event.currentTarget.src = defaultCover;
              setImageLoaded(true);
            }}
            className="h-full w-full object-cover"
          />
        </div>

        <div className="pointer-events-none relative z-[1] mt-3 w-full">
          <p
            className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-100"
            title={album_name}
          >
            {album_name}
          </p>

          {artist_name && (
            <p className="min-w-0 text-sm leading-5 text-zinc-500">
              <Link
                className="pointer-events-auto relative z-10 truncate hover:text-white hover:underline"
                href={`/artist?id=${artist_id}`}
              >
                {artist_name}
              </Link>
            </p>
          )}
        </div>
      </div>
    </AlbumMenu>
  );
}
