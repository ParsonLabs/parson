"use client";

import { usePlayer } from "@/features/player/player-context";
import SongMenu from "@/features/library/song-menu";
import { SongTitle, ExplicitBadge } from "./song-title";
import { isExplicitSongTitle } from "./song-presentation";
import { ArtistCreditLinks } from "./artist-credit-links";
import type { TrackArtistCreditPart } from "./track-artist-credit";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import Image from "next/image";
import Link from "next/link";

type SongCardProps = {
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  artistCredits?: TrackArtistCreditPart[];
  album_id: string;
  album_name: string;
  album_cover: string;
  path: string;
  typeLabel?: "Song";
};

export default function SongCard({
  song_name,
  song_id,
  artist_id,
  artist_name,
  artistCredits,
  album_id,
  album_name,
  album_cover,
  typeLabel,
}: SongCardProps) {
  const { playAudioSource, setQueue, setSongCallback, setCurrentSongIndex } =
    usePlayer();
  const imageSrc = album_cover
    ? `${getBaseURL()}/media/images/${encodeURIComponent(album_cover)}`
    : defaultCover;
  const artist = { id: artist_id, name: artist_name };
  const album = { id: album_id, name: album_name, cover_url: album_cover };

  function handlePlay() {
    const songInfo = { id: song_id, name: song_name, artist: artist_name };
    setQueue([{ song: songInfo, album, artist }]);
    setCurrentSongIndex(0);
    setSongCallback(songInfo, artist, album);
    playAudioSource();
  }

  return (
    <div className="w-full min-w-0">
      <SongMenu
        context="home"
        song_name={song_name}
        song_id={song_id}
        artist_id={artist_id}
        artist_name={artist_name}
        album_id={album_id}
        album_name={album_name}
        album_cover={album_cover}
      >
        <div className="group min-w-0">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[#111]">
            <Image
              src={imageSrc}
              alt={song_name}
              fill
              sizes="(min-width: 1024px) 260px, 42vw"
              className="cursor-pointer object-cover"
              onError={(event) => {
                event.currentTarget.src = defaultCover;
              }}
              onClick={handlePlay}
            />
          </div>

          <div className="mt-3 min-w-0">
            <Link
              href={`/album?id=${album_id}`}
              className="block truncate text-sm font-semibold leading-5 text-zinc-100 hover:underline"
            >
              <SongTitle title={song_name} />
            </Link>
            <p className="truncate text-sm leading-5 text-zinc-500">
              {typeLabel && <span>{typeLabel} · </span>}
              {isExplicitSongTitle(song_name) && <ExplicitBadge />}
              <ArtistCreditLinks
                credits={
                  artistCredits ?? [{ id: artist_id, name: artist_name }]
                }
              />
            </p>
          </div>
        </div>
      </SongMenu>
    </div>
  );
}
