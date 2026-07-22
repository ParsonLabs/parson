"use client";

import { usePlayer } from "@/features/player/player-context";
import getBaseURL from "@/lib/api/server-url";
import { AlbumArtFallback, getLibraryImageUrl } from "@/lib/images/image-url";
import {
  getAlbumInfo,
  searchLibrary,
  type LibraryAlbum,
} from "@parson/music-sdk";
import type { CombinedItem } from "@parson/music-sdk/types";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Play, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import AlbumMenu from "@/features/library/album-menu";
import ArtistMenu from "@/features/library/artist-menu";
import SongMenu from "@/features/library/song-menu";
import { toast } from "sonner";

const isPlayable = (item: CombinedItem) =>
  item.item_type === "song" || item.item_type === "album";

const hrefFor = (item: CombinedItem) =>
  item.item_type === "song"
    ? `/album?id=${item.album_object?.id ?? ""}`
    : `/${item.item_type}?id=${item.id}`;

function artworkFor(item: CombinedItem) {
  const image =
    item.item_type === "artist"
      ? item.artist_object?.icon_url
      : item.album_object?.cover_url;
  return getLibraryImageUrl(image, getBaseURL);
}

function SearchArtwork({ item }: { item: CombinedItem }) {
  const artwork = artworkFor(item);
  if (item.item_type === "artist" && !artwork) return null;

  const artworkContent = (
    <>
      {artwork ? (
        <Image
          alt=""
          className="object-cover"
          fill
          sizes="56px"
          src={artwork}
        />
      ) : (
        <AlbumArtFallback label={`${item.name} artwork unavailable`} />
      )}
    </>
  );
  const className = `relative h-14 w-14 shrink-0 overflow-hidden bg-white/[0.04] ${
    item.item_type === "artist" ? "rounded-full" : "rounded-md"
  }`;

  if (isPlayable(item)) {
    return (
      <div className={`${className} pointer-events-none`}>{artworkContent}</div>
    );
  }

  return (
    <Link
      href={hrefFor(item)}
      aria-label={`View ${item.name}`}
      className={className}
    >
      {artworkContent}
    </Link>
  );
}

function SearchResultMenu({
  children,
  item,
}: {
  children: ReactNode;
  item: CombinedItem;
}) {
  if (item.item_type === "song") {
    return (
      <SongMenu
        album_id={item.album_object?.id ?? ""}
        album_name={item.album_object?.name ?? "Unknown album"}
        album_cover={item.album_object?.cover_url}
        artist_id={item.artist_object?.id ?? ""}
        artist_name={item.artist_object?.name ?? "Unknown artist"}
        song_id={item.id}
        song_name={item.name}
      >
        {children}
      </SongMenu>
    );
  }
  if (item.item_type === "album") {
    return (
      <AlbumMenu album_id={item.id} artist_id={item.artist_object?.id ?? ""}>
        {children}
      </AlbumMenu>
    );
  }
  if (item.item_type === "artist") {
    return <ArtistMenu artistId={item.id}>{children}</ArtistMenu>;
  }
  return children;
}

export default function SearchResults() {
  const router = useRouter();
  const query = useSearchParams().get("q") ?? "";
  const searchTerm = query.trim();
  const search = useQuery({
    queryKey: ["search", searchTerm],
    queryFn: () => searchLibrary(searchTerm),
    enabled: Boolean(searchTerm),
  });
  const results = search.data ?? [];
  const uniqueResults = Array.from(
    new Map(
      results.map((item) => [`${item.item_type}-${item.id}`, item] as const),
    ).values(),
  );
  const { setCurrentSongIndex, setQueue, setSongCallback, playAudioSource } =
    usePlayer();
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  useEffect(() => {
    const id = "search-error";
    if (search.isError) {
      toast("Search could not reach the server.", {
        action: {
          label: "Try again",
          onClick: () => void search.refetch(),
        },
        id,
      });
    } else {
      toast.dismiss(id);
    }
  }, [search.isError, search.refetch]);

  const play = async (item: CombinedItem) => {
    if (!isPlayable(item)) return;
    const key = `${item.item_type}-${item.id}`;
    if (playingKey === key) return;
    setPlayingKey(key);
    try {
      if (item.item_type === "album") {
        const album = (await getAlbumInfo(item.id, false)) as LibraryAlbum;
        const firstSong = album.songs[0];
        const artist = album.artist_object;
        if (!firstSong || !artist) {
          toast("This album has no playable songs.");
          return;
        }
        setQueue(album.songs.map((song) => ({ song, artist, album })));
        setCurrentSongIndex(0);
        setSongCallback(firstSong, artist, album);
        playAudioSource();
        return;
      }

      const artist = item.artist_object ?? { id: "", name: "Unknown artist" };
      const album = item.album_object ?? { id: "", name: "Unknown album" };
      const track = {
        id: item.id,
        name: item.name,
        artist: artist.name,
        duration: item.song_object?.duration ?? 0,
      };
      setQueue([{ song: track, artist, album }]);
      setCurrentSongIndex(0);
      setSongCallback(track, artist, album);
      playAudioSource();
    } catch {
      toast(
        item.item_type === "album"
          ? "That album could not be played. Try again."
          : "That song could not be played. Try again.",
      );
    } finally {
      setPlayingKey(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-[760px] space-y-7 px-5 py-9 pb-36 sm:px-7">
      {searchTerm && (
        <h1 className="text-2xl font-semibold text-white">
          Results for &quot;{query}&quot;
        </h1>
      )}
      {!searchTerm && (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <Search className="mx-auto h-7 w-7 text-zinc-600" />
            <h1 className="mt-4 text-lg font-semibold text-zinc-200">
              Find anything in your library
            </h1>
          </div>
        </div>
      )}
      {search.isFetching && (
        <p className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}
      {!search.isFetching &&
        !search.isError &&
        searchTerm &&
        uniqueResults.length === 0 && (
          <div className="py-12 text-center">
            <p className="font-medium text-zinc-200">
              No matches for “{searchTerm}”
            </p>
          </div>
        )}
      <div>
        {uniqueResults.map((item) => {
          const playable = isPlayable(item);
          const playsOnRowClick = item.item_type === "song";
          const opensOnRowClick = item.item_type === "album";
          const key = `${item.item_type}-${item.id}`;
          const activateRow = () => {
            if (playsOnRowClick) void play(item);
            else if (opensOnRowClick) router.push(hrefFor(item));
          };
          return (
            <SearchResultMenu item={item} key={key}>
              <article
                className={`group relative flex items-center gap-4 border-b border-white/[0.07] px-2 py-3 transition-colors hover:bg-white/[0.025]`}
              >
                {(playsOnRowClick || opensOnRowClick) && (
                  <button
                    aria-label={
                      playsOnRowClick
                        ? `Play ${item.name}`
                        : `View ${item.name}`
                    }
                    className="absolute inset-0 z-0 cursor-pointer rounded-sm focus-visible:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    onClick={activateRow}
                    type="button"
                  />
                )}
                <SearchArtwork item={item} />
                <div
                  className={`relative z-[1] min-w-0 flex-1 ${playable ? "pointer-events-none" : ""}`}
                >
                  {playable ? (
                    <span className="block truncate text-[15px] font-medium text-zinc-100">
                      {item.name}
                    </span>
                  ) : (
                    <Link
                      href={hrefFor(item)}
                      className="block truncate text-[15px] font-medium text-zinc-100 hover:underline"
                    >
                      {item.name}
                    </Link>
                  )}
                  <p className="mt-0.5 truncate text-sm capitalize text-zinc-500">
                    {item.item_type}
                    {item.artist_object?.name && (
                      <>
                        {" · "}
                        {playable ? (
                          <span className="normal-case">
                            {item.artist_object.name}
                          </span>
                        ) : (
                          <Link
                            className="normal-case hover:text-zinc-300 hover:underline"
                            href={`/artist?id=${item.artist_object.id}`}
                          >
                            {item.artist_object.name}
                          </Link>
                        )}
                      </>
                    )}
                  </p>
                </div>
                {playable && (
                  <button
                    aria-label={`Play ${item.name}`}
                    className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                    onClick={(event) => {
                      event.stopPropagation();
                      void play(item);
                    }}
                    type="button"
                  >
                    {playingKey === key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                  </button>
                )}
              </article>
            </SearchResultMenu>
          );
        })}
      </div>
    </section>
  );
}
