"use client";

import LibraryStatus from "@/features/library/library-status";
import AlbumCard from "@/features/library/album-card";
import SongCard from "@/features/library/song-card";
import { useSession } from "@/features/account/session-provider";
import { Button } from "@/components/ui/button";
import {
  emptyLibraryFeed,
  useLibraryFeed,
} from "@/features/library/use-library-feed";
import { getLibraryUnavailable } from "@parson/music-sdk";
import type { LibrarySong, ResponseAlbum } from "@parson/music-sdk/types";
import { ChevronLeft, ChevronRight, Library } from "lucide-react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";

export default function LibraryFeed() {
  const { session } = useSession();
  const feedQuery = useLibraryFeed(Boolean(session));
  const feed = feedQuery.data ?? emptyLibraryFeed;
  const libraryReadiness = getLibraryUnavailable(feedQuery.error);

  const recentSongs = feed.continue_listening;
  const recommendedSongs =
    feed.recommended.length > 0 ? feed.recommended : feed.shuffle;
  const recommendedAlbums = feed.albums;

  if (libraryReadiness) {
    return (
      <LibraryStatus
        readiness={libraryReadiness}
        onRetry={() => void feedQuery.refetch()}
      />
    );
  }

  if (feedQuery.isPending) {
    return <HomeLoading />;
  }

  if (feedQuery.isError) {
    return (
      <HomeMessage
        title="Parson could not load your home feed"
        body="Your library is safe. Check the server connection and try again."
        action="Try again"
        onAction={() => void feedQuery.refetch()}
      />
    );
  }

  const hasContent =
    recentSongs.length > 0 ||
    recommendedSongs.length > 0 ||
    recommendedAlbums.length > 0;

  return (
    <div className="relative min-h-full py-7 pb-36">
      <div className="mx-auto w-full max-w-[1064px] px-5 sm:px-7">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold text-white">Home</h1>
        </header>

        {!hasContent && (
          <HomeMessage
            title="Your music is ready"
            body="Browse your collection or add more music from Settings."
            action="Open library"
            href="/library"
          />
        )}
        <div className="space-y-11">
          {recentSongs.length > 0 && (
            <FeedRow title="Recently played">
              <RecentRow songs={recentSongs} />
            </FeedRow>
          )}

          {recommendedSongs.length > 0 && (
            <FeedRow title="Recommended songs">
              <SongRow songs={recommendedSongs} />
            </FeedRow>
          )}

          {recommendedAlbums.length > 0 && (
            <FeedRow title="Albums you might like">
              <AlbumRow albums={recommendedAlbums.slice(0, 6)} />
            </FeedRow>
          )}
        </div>
      </div>
    </div>
  );
}

function HomeLoading() {
  return (
    <div className="relative min-h-full py-7 pb-36">
      <div className="mx-auto w-full max-w-[1064px] px-5 sm:px-7">
        <div className="mb-10 h-9 w-24 animate-pulse rounded-md bg-white/[0.05]" />
        <div className="space-y-11">
          {Array.from({ length: 3 }).map((_, row) => (
            <section className="mx-auto w-full max-w-[1000px]" key={row}>
              <div className="mb-4 h-5 w-44 animate-pulse rounded bg-white/[0.05]" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 lg:gap-5">
                {Array.from({ length: 4 }).map((_, card) => (
                  <div className="min-w-0 space-y-3" key={card}>
                    <div className="aspect-square animate-pulse rounded-lg bg-white/[0.045]" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.05]" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.035]" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeMessage({
  action,
  body,
  href,
  onAction,
  title,
}: {
  action: string;
  body: string;
  href?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 px-6 text-center">
      <div className="max-w-sm">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{body}</p>
        <div className="mt-5 flex justify-center">
          {href ? (
            <Button asChild variant="outline">
              <Link href={href}>
                <Library /> {action}
              </Link>
            </Button>
          ) : (
            <Button onClick={onAction} variant="outline">
              {action}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SongRow({ songs }: { songs: LibrarySong[] }) {
  return (
    <>
      {songs.map((song) => (
        <div key={song.id} className="min-w-0 snap-start">
          <SongCard
            song_name={song.name}
            song_id={song.id}
            path={song.path}
            artist_id={song.artist_object?.id}
            artist_name={song.artist_object?.name ?? song.artist}
            album_id={song.album_object?.id}
            album_name={song.album_object?.name}
            album_cover={song.album_object?.cover_url}
          />
        </div>
      ))}
    </>
  );
}

function RecentRow({ songs }: { songs: LibrarySong[] }) {
  const counts = new Map<string, number>();
  for (const song of songs) {
    const albumId = song.album_object.id;
    counts.set(albumId, (counts.get(albumId) ?? 0) + 1);
  }
  const emittedAlbums = new Set<string>();

  return (
    <>
      {songs.map((song, index) => {
        const album = song.album_object;
        if ((counts.get(album.id) ?? 0) > 3) {
          if (emittedAlbums.has(album.id)) return null;
          emittedAlbums.add(album.id);
          return (
            <div key={`album-${album.id}`} className="min-w-0 snap-start">
              <AlbumCard
                album_cover={album.cover_url}
                album_id={album.id}
                album_name={album.name}
                artist_id={song.artist_object.id}
                artist_name={song.artist_object.name}
                first_release_date={album.first_release_date}
              />
            </div>
          );
        }
        return (
          <div key={`${song.id}-${index}`} className="min-w-0 snap-start">
            <SongCard
              album_cover={song.album_object?.cover_url}
              album_id={song.album_object?.id}
              album_name={song.album_object?.name}
              artist_id={song.artist_object?.id}
              artist_name={song.artist_object?.name ?? song.artist}
              path={song.path}
              song_id={song.id}
              song_name={song.name}
            />
          </div>
        );
      })}
    </>
  );
}

function AlbumRow({ albums }: { albums: ResponseAlbum[] }) {
  return (
    <>
      {albums.map((album) => (
        <div key={album.id} className="min-w-0 snap-start">
          <AlbumCard
            artist_id={album.artist_object.id}
            artist_name={album.artist_object.name}
            album_id={album.id}
            album_name={album.name}
            album_cover={album.cover_url}
            first_release_date={album.first_release_date}
          />
        </div>
      ))}
    </>
  );
}

function FeedRow({ children, title }: { children: ReactNode; title: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scroll = (direction: "left" | "right") => {
    const node = scrollRef.current;
    if (!node) return;
    const amount = Math.min(720, node.clientWidth * 0.85);
    node.scrollBy({
      left: direction === "left" ? -amount : amount,
      behavior: "smooth",
    });
  };

  return (
    <section className="mx-auto w-full max-w-[1000px]">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-[18px] font-semibold text-zinc-50">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label={`Scroll ${title} left`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#111] text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label={`Scroll ${title} right`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#111] text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="grid snap-x snap-mandatory grid-flow-col auto-cols-[calc((100%_-_36px)/2)] gap-3 overflow-x-auto overflow-y-visible pb-2 [scrollbar-width:none] sm:auto-cols-[calc((100%_-_48px)/3)] sm:gap-4 lg:auto-cols-[calc((100%_-_60px)/4)] lg:gap-5 [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </section>
  );
}
