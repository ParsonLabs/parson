"use client";

import getBaseURL from "@/lib/api/server-url";
import { getLibraryImageUrl } from "@/lib/images/image-url";
import {
  addAlbumToPlaylist as addAlbumTracksToPlaylist,
  getPlaylists,
  type LibraryAlbum,
} from "@parson/music-sdk";
import type { Artist } from "@parson/music-sdk/types";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Download,
  ListEnd,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { downloadAlbum } from "@/lib/downloads/download-album";
import { usePlayer } from "@/features/player/player-context";
import { useSession } from "@/features/account/session-provider";
import AlbumEditor from "@/features/library/album-editor";
import { useAlbum } from "@/features/library/use-library-entity";
import CreatePlaylistDialog from "@/features/library/create-playlist-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { usePageTitle } from "@/components/app/title-metadata";
import { useFitText } from "@/features/library/use-fit-text";
import { AlbumTrackList } from "./album-track-list";
import EntityPageState from "@/features/library/entity-page-state";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

function formatTotalDuration(duration: number) {
  const minutes = Math.max(1, Math.round(duration / 60));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} hr ${remainingMinutes} min`
    : `${hours} hr`;
}

function splitQualifiedTitle(title: string) {
  const parenthesis = title.indexOf("(");
  const bracket = title.indexOf("[");
  const candidates = [parenthesis, bracket].filter((index) => index > 0);
  const splitAt = candidates.length ? Math.min(...candidates) : -1;
  if (splitAt < 0) return null;
  return [title.slice(0, splitAt).trimEnd(), title.slice(splitAt)] as const;
}

type AlbumDetailsProps = {
  devAlbum?: LibraryAlbum;
};

export default function AlbumDetails({ devAlbum }: AlbumDetailsProps = {}) {
  const searchParams = useSearchParams();
  const id = searchParams?.get("id");
  const { session } = useSession();

  const queryClient = useQueryClient();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: getPlaylists,
    enabled: actionsOpen,
  });

  const albumQuery = useAlbum(id, devAlbum);
  const album = albumQuery.data ?? null;
  const artist: Artist | null = album?.artist_object ?? null;
  usePageTitle(
    album ? [album.name, artist?.name].filter(Boolean).join(" - ") : null,
  );
  const {
    fontSize: titleFontSize,
    textRef: titleRef,
    wrapped: titleWrapped,
    wrapperRef: titleWrapRef,
  } = useFitText(album?.name);

  const {
    setCurrentSongIndex,
    addToQueue,
    setQueue,
    setSongCallback,
    playAudioSource,
    togglePlayPause,
    isPlaying,
    song: currentSong,
  } = usePlayer();

  const albumCoverURL = useMemo(
    () => getLibraryImageUrl(album?.cover_url, getBaseURL),
    [album?.cover_url],
  );
  const artistIconURL = useMemo(
    () => getLibraryImageUrl(artist?.icon_url, getBaseURL),
    [artist?.icon_url],
  );

  const totalDuration = useMemo(() => {
    return (album?.songs || []).reduce(
      (acc, song) => acc + (song.duration || 0),
      0,
    );
  }, [album?.songs]);
  const addAlbumToPlaylist = useMutation({
    mutationFn: async ({ id }: { id: number; name: string }) => {
      if (!album) throw new Error("Album unavailable");
      await addAlbumTracksToPlaylist(id, album.id);
    },
    onSuccess: async (_, playlist) => {
      toast.success(`Added album to ${playlist.name}`);
      await queryClient.invalidateQueries({
        queryKey: ["playlist", playlist.id],
        refetchType: "none",
      });
      await queryClient.invalidateQueries({
        queryKey: ["playlists"],
        refetchType: "none",
      });
    },
    onError: () => toast("Could not add this album."),
  });

  const addAlbumToQueue = () => {
    if (!album || !artist) return;
    addToQueue(
      album.songs.map((song) => ({
        song,
        album,
        artist,
      })),
    );
    toast.success(`Added ${album.name} to queue`);
  };

  const saveAlbum = () => {
    if (!album) return;
    const count = downloadAlbum(album);
    if (count) toast.success(`Downloading ${count} songs from ${album.name}`);
  };

  const playTrack = (track: LibraryAlbum["songs"][number]) => {
    if (!album || !artist) return;
    if (currentSong?.id === track.id) {
      togglePlayPause();
      return;
    }

    const index = album.songs.findIndex((song) => song.id === track.id);
    setQueue(album.songs.map((song) => ({ song, album, artist })));
    setCurrentSongIndex(Math.max(index, 0));
    setSongCallback(track, artist, album);
    playAudioSource();
  };

  const playAlbum = () => {
    const firstSong = album?.songs?.[0];
    if (!artist || !firstSong) return;
    playTrack(firstSong);
  };

  if (!id && !devAlbum) return <EntityPageState kind="album" />;
  if (albumQuery.isPending) return <EntityPageState kind="album" loading />;
  if (albumQuery.isError || !album || !artist)
    return (
      <EntityPageState kind="album" onRetry={() => void albumQuery.refetch()} />
    );

  const isAlbumPlaying =
    isPlaying && currentSong?.album_object?.id === album.id;
  const titleParts = titleWrapped ? splitQualifiedTitle(album.name) : null;

  return (
    <div className="tidal-route relative text-zinc-50">
      <div className="relative mx-auto max-w-[900px] px-5 pb-24 pt-8 sm:px-7">
        <div className="mb-8 flex w-full flex-col items-start gap-6 sm:flex-row sm:items-end">
          {albumCoverURL && (
            <div className="relative h-44 w-44 shrink-0 overflow-hidden rounded-md border border-white/5 sm:h-52 sm:w-52">
              <Image
                src={albumCoverURL}
                alt={album.name}
                fill
                className="object-cover"
                sizes="208px"
                priority
              />
            </div>
          )}

          <div
            ref={titleWrapRef}
            className="flex w-full min-w-0 flex-1 flex-col"
          >
            <span className="text-xs font-bold tracking-widest text-zinc-200 uppercase mb-2">
              Album
            </span>
            <h1
              ref={titleRef}
              className={`mb-5 font-black leading-[0.95] text-white ${titleWrapped ? "text-balance whitespace-normal" : "whitespace-nowrap"}`}
              style={{ fontSize: titleFontSize, letterSpacing: 0 }}
            >
              {titleParts ? (
                <>
                  <span className="block">{titleParts[0]}</span>
                  <span className="block">{titleParts[1]}</span>
                </>
              ) : (
                album.name
              )}
            </h1>
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-300 flex-wrap">
              {artistIconURL && (
                <div className="relative w-6 h-6 rounded-full overflow-hidden">
                  <Image
                    src={artistIconURL}
                    alt={artist.name}
                    fill
                    className="object-cover"
                    sizes="24px"
                  />
                </div>
              )}
              <Link
                href={`/artist?id=${artist.id}`}
                className="text-white hover:underline cursor-pointer font-bold"
              >
                {artist.name}
              </Link>
              <span className="text-zinc-500">•</span>
              <span>
                {album.songs.length} songs, {formatTotalDuration(totalDuration)}
              </span>
            </div>
          </div>
        </div>

        <div className="mb-7 flex items-center gap-5">
          <button
            aria-label={`${isAlbumPlaying ? "Pause" : "Play"} ${album.name}`}
            onClick={playAlbum}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black transition-all hover:scale-105 hover:bg-zinc-100"
            type="button"
          >
            {isAlbumPlaying ? (
              <Pause className="w-6 h-6 fill-black text-black" />
            ) : (
              <Play className="ml-1 w-6 h-6 fill-black text-black" />
            )}
          </button>
          <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Album actions"
                className="text-zinc-400 transition-colors hover:text-white"
                type="button"
              >
                <MoreHorizontal className="h-8 w-8" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onSelect={playAlbum}>
                <Play className="h-4 w-4 fill-current" />
                Play
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={addAlbumToQueue}>
                <ListEnd className="h-4 w-4" />
                Add to queue
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={saveAlbum}>
                <Download className="h-4 w-4" />
                Download album
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`/artist?id=${artist.id}`}>
                  <UserRound className="h-4 w-4" />
                  View artist
                </Link>
              </DropdownMenuItem>
              {session?.role === "admin" && (
                <AlbumEditor albumId={album.id} trigger="dropdown" />
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ListPlus className="h-4 w-4" />
                  Add to playlist
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {playlists.isPending && (
                    <DropdownMenuItem disabled>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading playlists…
                    </DropdownMenuItem>
                  )}
                  {playlists.isError && (
                    <DropdownMenuItem onSelect={() => void playlists.refetch()}>
                      <RefreshCw className="h-4 w-4" />
                      Try loading again
                    </DropdownMenuItem>
                  )}
                  {playlists.data?.map((playlist) => (
                    <DropdownMenuItem
                      disabled={addAlbumToPlaylist.isPending}
                      key={playlist.id}
                      onSelect={() =>
                        addAlbumToPlaylist.mutate({
                          id: playlist.id,
                          name: playlist.name,
                        })
                      }
                    >
                      <ListPlus className="h-4 w-4" />
                      <span className="truncate">{playlist.name}</span>
                    </DropdownMenuItem>
                  ))}
                  {playlists.isSuccess && (
                    <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" />
                      New playlist
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <CreatePlaylistDialog
            initialAlbumId={album?.id}
            onOpenChange={setCreateOpen}
            open={createOpen}
          />
        </div>

        <AlbumTrackList
          activeSongId={currentSong?.id}
          album={album}
          artistName={artist.name}
          onPlay={playTrack}
        />
      </div>
    </div>
  );
}
