"use client";

import { defaultCover } from "@/lib/images/default-cover";
import getBaseURL from "@/lib/api/server-url";
import type { LibrarySong } from "@parson/music-sdk";
import { ListMusic } from "lucide-react";
import Image from "next/image";

export default function PlaylistCover({
  className = "",
  songs,
}: {
  className?: string;
  songs: LibrarySong[];
}) {
  const covers = songs.slice(0, 4).map((song) => ({
    albumId: song.album_object.id,
    src: song.album_object.cover_url
      ? `${getBaseURL()}/media/images/${encodeURIComponent(
          song.album_object.cover_url,
        )}`
      : defaultCover,
  }));

  if (!covers.length) {
    return (
      <div
        className={`grid place-items-center bg-white/[0.06] text-zinc-600 ${className}`}
      >
        <ListMusic className="h-1/3 w-1/3" />
      </div>
    );
  }

  if (new Set(covers.map((cover) => cover.albumId)).size === 1) {
    const source = covers[0]!.src;
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="192px"
          src={source}
        />
      </div>
    );
  }

  const quadrants = Array.from(
    { length: 4 },
    (_, index) => covers[index % covers.length]!.src,
  );

  return (
    <div className={`grid grid-cols-2 overflow-hidden ${className}`}>
      {quadrants.map((src, index) => (
        <div className="relative" key={`${src}-${index}`}>
          <Image alt="" className="object-cover" fill sizes="96px" src={src} />
        </div>
      ))}
    </div>
  );
}
