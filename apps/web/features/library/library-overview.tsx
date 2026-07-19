"use client";

import { Button } from "@/components/ui/button";
import AlbumCard from "@/features/library/album-card";
import ArtistMenu from "@/features/library/artist-menu";
import CreatePlaylistDialog from "@/features/library/create-playlist-dialog";
import PlaylistCover from "@/features/library/playlist-cover";
import PlaylistMenu from "@/features/library/playlist-menu";
import SongMenu from "@/features/library/song-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePlayer } from "@/features/player/player-context";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import {
  getFavoriteSongDetails,
  getLibraryCatalog,
  getLibraryCatalogArtists,
  getPlaylist,
  getPlaylists,
  type LibraryCatalogArtist,
  type LibraryCatalogSong,
} from "@parson/music-sdk";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Disc3,
  ChevronRight,
  ListMusic,
  Heart,
  Music2,
  Pause,
  Play,
  Plus,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { uniqueById } from "./library-items";
import LikedSongsView from "./liked-songs-view";
import {
  InfiniteLoad,
  LibraryLoading,
  LibraryMessage,
  formatDuration,
} from "./library-view-primitives";

const PAGE_SIZE = 100;
const views = ["albums", "songs", "liked", "artists", "playlists"] as const;
type LibraryView = (typeof views)[number];

export default function LibraryOverview() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const [view, setView] = useState<LibraryView>(() =>
    views.includes(requestedView as LibraryView)
      ? (requestedView as LibraryView)
      : "albums",
  );
  const catalogEnabled = view === "albums" || view === "songs";

  const catalog = useInfiniteQuery({
    queryKey: ["library", "catalog", view],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getLibraryCatalog(pageParam, PAGE_SIZE, view as "albums" | "songs"),
    getNextPageParam: (lastPage, pages) => {
      const next = pages.length * PAGE_SIZE;
      const total =
        view === "albums" ? lastPage.totalAlbums : lastPage.totalSongs;
      return next < total ? next : undefined;
    },
    enabled: catalogEnabled,
  });
  const artists = useInfiniteQuery({
    queryKey: ["library", "catalog", "artists"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getLibraryCatalogArtists(pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: view === "artists",
  });
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: getPlaylists,
    enabled: view === "playlists",
  });

  const favorites = useInfiniteQuery({
    queryKey: ["favorite-song-details"],
    initialPageParam: undefined as
      { before_added_at: string; before_song_id: string } | undefined,
    queryFn: async ({ pageParam }) => {
      const details = await getFavoriteSongDetails({
        limit: PAGE_SIZE,
        ...pageParam,
      });
      for (const detail of details) {
        queryClient.setQueryData(["favorite-membership", detail.song_id], true);
      }
      return details;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage.at(-1);
      return last
        ? { before_added_at: last.added_at, before_song_id: last.song_id }
        : undefined;
    },
    enabled: view === "liked",
  });
  const favoriteSongs =
    favorites.data?.pages.flatMap((page) => page.map((item) => item.song)) ??
    [];

  const catalogPages = catalog.data?.pages ?? [];
  const allAlbums = uniqueById(catalogPages.flatMap((page) => page.albums));
  const allSongs = uniqueById(catalogPages.flatMap((page) => page.songs));
  const allArtists = uniqueById(artists.data?.pages.flat() ?? []);
  const initialLoading =
    (catalogEnabled && catalog.isPending && !catalog.data) ||
    (view === "artists" && artists.isPending && !artists.data) ||
    (view === "playlists" && playlists.isPending) ||
    (view === "liked" && favorites.isPending);
  const activeError =
    (catalogEnabled ? catalog.error : null) ??
    (view === "liked" ? favorites.error : null) ??
    (view === "artists" ? artists.error : null) ??
    (view === "playlists" ? playlists.error : null);

  const selectView = (nextView: LibraryView) => {
    setView(nextView);
    const next = new URLSearchParams(window.location.search);
    if (nextView === "albums") next.delete("view");
    else next.set("view", nextView);
    window.history.replaceState(
      window.history.state,
      "",
      `/library${next.size ? `?${next}` : ""}`,
    );
  };

  useEffect(() => {
    const syncFromHistory = () => {
      const requested = new URLSearchParams(window.location.search).get("view");
      setView(
        views.includes(requested as LibraryView)
          ? (requested as LibraryView)
          : "albums",
      );
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  return (
    <section className="mx-auto w-full max-w-[1064px] space-y-7">
      <header className="flex items-end justify-between gap-5">
        <h1 className="text-3xl font-semibold text-white">Library</h1>
      </header>

      <div className="flex min-h-11 min-w-0 items-end border-b border-white/[0.08]">
        <div
          aria-label="Library views"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          <LibraryTab
            active={view === "albums"}
            icon={<Disc3 />}
            label="Albums"
            onClick={() => selectView("albums")}
          />
          <LibraryTab
            active={view === "songs"}
            icon={<Music2 />}
            label="Songs"
            onClick={() => selectView("songs")}
          />
          <LibraryTab
            active={view === "liked"}
            icon={<Heart />}
            label="Liked Songs"
            onClick={() => selectView("liked")}
          />
          <LibraryTab
            active={view === "artists"}
            icon={<UserRound />}
            label="Artists"
            onClick={() => selectView("artists")}
          />
          <LibraryTab
            active={view === "playlists"}
            icon={<ListMusic />}
            label="Playlists"
            onClick={() => selectView("playlists")}
          />
        </div>
        {view === "playlists" && (
          <div className="mb-2 ml-2 shrink-0">
            <CreatePlaylistButton />
          </div>
        )}
      </div>

      {activeError && (
        <p className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100">
          Some items could not be loaded. You can retry below.
        </p>
      )}

      {view === "albums" && (
        <AlbumsView
          albums={allAlbums}
          hasMore={catalog.hasNextPage}
          loading={initialLoading}
          loadingMore={catalog.isFetchingNextPage}
          onLoadMore={() => void catalog.fetchNextPage()}
        />
      )}
      {view === "songs" && (
        <SongsView
          songs={allSongs}
          hasMore={catalog.hasNextPage}
          loading={initialLoading}
          loadingMore={catalog.isFetchingNextPage}
          onLoadMore={() => void catalog.fetchNextPage()}
        />
      )}
      {view === "liked" && (
        <LikedSongsView
          error={Boolean(favorites.error)}
          hasMore={favorites.hasNextPage}
          loading={favorites.isPending}
          loadingMore={favorites.isFetchingNextPage}
          onLoadMore={() => void favorites.fetchNextPage()}
          onRetry={() => void favorites.refetch()}
          songs={favoriteSongs}
        />
      )}
      {view === "artists" && (
        <ArtistsView
          artists={allArtists}
          hasMore={artists.hasNextPage}
          loading={artists.isPending}
          loadingMore={artists.isFetchingNextPage}
          onLoadMore={() => void artists.fetchNextPage()}
        />
      )}
      {view === "playlists" && (
        <PlaylistsView
          loading={playlists.isPending}
          onOpenLiked={() => selectView("liked")}
          playlists={playlists.data}
        />
      )}
    </section>
  );
}

function LibraryTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={`relative flex h-11 shrink-0 items-center gap-2 px-4 text-sm font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4 ${
        active ? "text-white" : "text-zinc-500 hover:text-zinc-200"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {icon}
      {label}
      {active && (
        <span className="absolute inset-x-3 bottom-0 h-0.5 bg-white" />
      )}
    </button>
  );
}

function AlbumsView({
  albums,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
}: {
  albums: Awaited<ReturnType<typeof getLibraryCatalog>>["albums"];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (loading) return <LibraryLoading compact />;
  if (!albums.length)
    return (
      <LibraryMessage
        title="No albums yet"
        body="Add music to your indexed folder. New albums appear here automatically."
        href="/settings"
        action="Open settings"
      />
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {albums.map((album) => (
          <AlbumCard
            key={album.id}
            album_id={album.id}
            album_name={album.name}
            album_cover={album.coverPath}
            artist_id={album.artistId}
            artist_name={album.artistName}
            first_release_date={album.releaseYear}
          />
        ))}
      </div>
      <InfiniteLoad
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

function SongsView({
  songs,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
}: {
  songs: LibraryCatalogSong[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (loading) return <LibraryLoading compact />;
  if (!songs.length)
    return (
      <LibraryMessage
        title="No songs yet"
        body="Add supported audio files to your indexed folder. They appear automatically when copying finishes."
        href="/settings"
        action="Open settings"
      />
    );
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        {songs.map((song, index) => (
          <CatalogSongRow key={song.id} index={index} song={song} />
        ))}
      </div>
      <InfiniteLoad
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

function CatalogSongRow({
  index,
  song,
}: {
  index: number;
  song: LibraryCatalogSong;
}) {
  const player = usePlayer();
  const active = player.song.id === song.id;
  const artwork = song.coverPath
    ? `${getBaseURL()}/media/images/${encodeURIComponent(song.coverPath)}`
    : defaultCover;

  const play = () => {
    if (active) {
      player.togglePlayPause();
      return;
    }
    const artist = { id: song.artistId, name: song.artistName };
    const album = {
      id: song.albumId,
      name: song.albumName,
      cover_url: song.coverPath,
    };
    const track = {
      id: song.id,
      name: song.name,
      artist: song.artistName,
      path: song.path,
      duration: song.durationSeconds,
    };
    player.setQueue([{ song: track, artist, album }]);
    player.setCurrentSongIndex(0);
    player.setSongCallback(track, artist, album);
    player.playAudioSource();
  };

  return (
    <SongMenu
      album_id={song.albumId}
      album_name={song.albumName}
      album_cover={song.coverPath}
      artist_id={song.artistId}
      artist_name={song.artistName}
      song_id={song.id}
      song_name={song.name}
    >
      <div className="group grid grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-white/[0.06] px-3 py-2 last:border-0 hover:bg-white/[0.035] sm:grid-cols-[2rem_3rem_minmax(0,1fr)_minmax(8rem,0.6fr)_auto] sm:gap-3">
        <button
          aria-label={`${active && player.isPlaying ? "Pause" : "Play"} ${song.name}`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"
          onClick={play}
          type="button"
        >
          {active && player.isPlaying ? (
            <Pause className="h-4 w-4 fill-current text-white" />
          ) : (
            <>
              <span className="text-xs group-hover:hidden">{index + 1}</span>
              <Play className="hidden h-4 w-4 fill-current group-hover:block" />
            </>
          )}
        </button>
        <div className="relative h-10 w-10 overflow-hidden rounded-md bg-zinc-900">
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="40px"
            src={artwork}
          />
        </div>
        <div className="min-w-0">
          <p
            className={`truncate text-sm font-medium ${active ? "text-white" : "text-zinc-200"}`}
          >
            {song.name}
          </p>
          <Link
            className="truncate text-xs text-zinc-500 hover:text-white hover:underline sm:hidden"
            href={`/artist?id=${song.artistId}`}
          >
            {song.artistName}
          </Link>
        </div>
        <Link
          className="hidden truncate text-sm text-zinc-500 hover:text-white hover:underline sm:block"
          href={`/artist?id=${song.artistId}`}
        >
          {song.artistName}
        </Link>
        <span className="pr-2 text-xs tabular-nums text-zinc-600">
          {formatDuration(song.durationSeconds)}
        </span>
      </div>
    </SongMenu>
  );
}

function ArtistsView({
  artists,
  hasMore,
  loading,
  loadingMore,
  onLoadMore,
}: {
  artists: LibraryCatalogArtist[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (loading) return <LibraryLoading compact />;
  if (!artists.length)
    return (
      <LibraryMessage
        title="No artists yet"
        body="Artists will appear after Parson indexes your collection."
      />
    );
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-white/[0.08]">
        {artists.map((artist) => (
          <ArtistRow artist={artist} key={artist.id} />
        ))}
      </div>
      <InfiniteLoad
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
      />
    </>
  );
}

function ArtistRow({ artist }: { artist: LibraryCatalogArtist }) {
  return (
    <ArtistMenu artistId={artist.id}>
      <Link
        className="group flex min-w-0 items-center gap-4 border-b border-white/[0.06] px-4 py-4 transition-colors last:border-0 hover:bg-white/[0.035] sm:px-5"
        href={`/artist?id=${artist.id}`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-zinc-100 group-hover:text-white">
            {artist.name}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {artist.albumCount} {artist.albumCount === 1 ? "album" : "albums"}
            {" · "}
            {artist.songCount} {artist.songCount === 1 ? "song" : "songs"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-white" />
      </Link>
    </ArtistMenu>
  );
}

function PlaylistsView({
  loading,
  onOpenLiked,
  playlists,
}: {
  loading: boolean;
  onOpenLiked: () => void;
  playlists?: Awaited<ReturnType<typeof getPlaylists>>;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="min-h-64">
            {loading ? (
              <LibraryLoading compact />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <LikedSongsPlaylistCard onOpen={onOpenLiked} />
                {playlists?.map((playlist) => (
                  <PlaylistCard key={playlist.id} playlist={playlist} />
                ))}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus />
            Create playlist
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CreatePlaylistDialog onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}

function LikedSongsPlaylistCard({ onOpen }: { onOpen: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          aria-label="Open Liked Songs"
          className="group flex min-w-0 items-center gap-4 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.06]"
          onClick={onOpen}
          type="button"
        >
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-rose-500 to-fuchsia-800 text-white">
            <Heart className="h-6 w-6 fill-current" />
          </div>
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
            Liked Songs
          </h2>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-white" />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>
          <Heart className="h-4 w-4" />
          Go to Liked Songs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PlaylistCard({
  playlist,
}: {
  playlist: Awaited<ReturnType<typeof getPlaylists>>[number];
}) {
  const player = usePlayer();
  const play = async () => {
    const detail = await getPlaylist(playlist.id);
    const first = detail.songs[0];
    if (!first) return;
    player.setQueue(
      detail.songs.map((song) => ({
        song,
        artist: song.artist_object,
        album: song.album_object,
      })),
    );
    player.setCurrentSongIndex(0);
    player.setSongCallback(first, first.artist_object, first.album_object);
    player.playAudioSource();
  };
  return (
    <PlaylistMenu playlistId={playlist.id}>
      <div className="group relative flex min-w-0 items-center gap-4 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.06]">
        <button
          aria-label={`Play ${playlist.name}`}
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
          onClick={() => void play()}
          type="button"
        />
        <div className="pointer-events-none relative z-10 h-14 w-14 shrink-0">
          <PlaylistCover
            className="h-14 w-14 rounded-lg"
            songs={playlist.cover_songs}
          />
        </div>
        <h2 className="pointer-events-none relative z-10 min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">
          {playlist.name}
        </h2>
        <Link
          aria-label={`Open ${playlist.name}`}
          className="relative z-20 rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          href={`/playlist?id=${playlist.id}`}
        >
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-white" />
        </Link>
      </div>
    </PlaylistMenu>
  );
}

function CreatePlaylistButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        className="h-7 rounded px-2.5 text-xs bg-white text-black hover:bg-zinc-200 [&_svg]:size-3.5"
        onClick={() => setOpen(true)}
        size="sm"
      >
        <Plus /> New playlist
      </Button>
      <CreatePlaylistDialog onOpenChange={setOpen} open={open} />
    </>
  );
}
