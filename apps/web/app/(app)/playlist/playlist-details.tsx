"use client";

import { Button } from "@/components/ui/button";
import PlaylistCover from "@/features/library/playlist-cover";
import { usePlayer } from "@/features/player/player-context";
import {
  deletePlaylist,
  getPlaylist,
  updatePlaylist,
  removeSongFromPlaylist,
  type PlaylistResponse,
  type PlaylistSummary,
} from "@parson/music-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PlaylistActions, PlaylistTracks } from "./playlist-components";

export default function PlaylistDetails() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Number(searchParams.get("id"));
  const validId = Number.isSafeInteger(id) && id > 0;
  const playlist = useQuery({
    queryKey: ["playlist", id],
    queryFn: () => getPlaylist(id),
    enabled: validId,
  });
  const songIds = useMemo(
    () => playlist.data?.song_infos.map((item) => item.song_id) ?? [],
    [playlist.data?.song_infos],
  );
  const remove = useMutation({
    mutationFn: (songId: string) => removeSongFromPlaylist(id, songId),
    onSuccess: (_result, songId) => {
      const currentPlaylist = queryClient.getQueryData<PlaylistResponse>([
        "playlist",
        id,
      ]);
      const removedSong = currentPlaylist?.songs.find(
        (song) => song.id === songId,
      );
      const remainingSongs = currentPlaylist?.songs.filter(
        (song) => song.id !== songId,
      );
      queryClient.setQueryData<PlaylistResponse>(
        ["playlist", id],
        (current) => {
          if (!current) return current;
          const songs = current.songs.filter((song) => song.id !== songId);
          return {
            ...current,
            songs,
            song_infos: current.song_infos.filter(
              (item) => item.song_id !== songId,
            ),
            song_count: songs.length,
            total_duration: songs.reduce(
              (total, song) => total + (song.duration || 0),
              0,
            ),
            cover_songs: songs.slice(0, 4),
          };
        },
      );
      queryClient.setQueryData<PlaylistSummary[]>(["playlists"], (current) =>
        current?.map((item) =>
          item.id === id
            ? {
                ...item,
                song_count: Math.max(0, item.song_count - 1),
                total_duration: Math.max(
                  0,
                  item.total_duration - (removedSong?.duration || 0),
                ),
                cover_songs: remainingSongs?.slice(0, 4) ?? item.cover_songs,
              }
            : item,
        ),
      );
      toast.success("Removed from playlist");
    },
    onError: () => toast("Could not remove this song."),
  });
  const removePlaylist = useMutation({
    mutationFn: () => deletePlaylist(id),
    onSuccess: () => {
      queryClient.setQueryData<PlaylistSummary[]>(["playlists"], (current) =>
        current?.filter((item) => item.id !== id),
      );
      queryClient.removeQueries({ queryKey: ["playlist", id], exact: true });
      toast.success("Playlist deleted");
      router.replace("/library?view=playlists");
    },
    onError: () => toast("Could not delete the playlist."),
  });
  const player = usePlayer();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const editPlaylist = useMutation({
    mutationFn: () =>
      updatePlaylist(id, {
        name: editName.trim(),
        description: editDescription.trim(),
      }),
    onSuccess: () => {
      const name = editName.trim();
      const description = editDescription.trim();
      queryClient.setQueryData<PlaylistResponse>(["playlist", id], (current) =>
        current ? { ...current, name, description } : current,
      );
      queryClient.setQueryData<PlaylistSummary[]>(["playlists"], (current) =>
        current?.map((item) =>
          item.id === id ? { ...item, name, description } : item,
        ),
      );
      setEditOpen(false);
      toast.success("Playlist updated");
    },
    onError: () => toast("Could not update the playlist."),
  });
  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editName.trim()) editPlaylist.mutate();
  };

  const playFrom = (index: number) => {
    const queue = playlist.data?.songs ?? [];
    const selected = queue[index];
    if (!selected) return;
    player.setQueue(
      queue.map((song) => ({
        song,
        artist: song.artist_object,
        album: song.album_object,
      })),
    );
    player.setCurrentSongIndex(index);
    player.setSongCallback(
      selected,
      selected.artist_object,
      selected.album_object,
    );
    player.playAudioSource();
  };

  if (!validId)
    return (
      <PlaylistMessage
        title="Playlist not found"
        body="This playlist link is not valid."
      />
    );
  if (playlist.isPending)
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-zinc-500">
        <span className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading playlist…
        </span>
      </div>
    );
  if (playlist.isError || !playlist.data)
    return (
      <PlaylistMessage
        title="Playlist unavailable"
        body="It may have been removed, or the server could not be reached."
        onRetry={() => void playlist.refetch()}
      />
    );

  const tracks = playlist.data.songs;
  const totalDuration = tracks.reduce(
    (sum, song) => sum + (song.duration || 0),
    0,
  );
  const openEdit = () => {
    setEditName(playlist.data.name);
    setEditDescription(playlist.data.description ?? "");
    setEditOpen(true);
  };
  return (
    <section className="mx-auto w-full max-w-[1000px] px-5 py-9 pb-36 sm:px-7">
      <Link
        className="text-sm text-zinc-500 hover:text-white"
        href="/library?view=playlists"
      >
        Playlists
      </Link>
      <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end">
        <PlaylistCover
          className="h-40 w-40 shrink-0 rounded-xl shadow-2xl shadow-black sm:h-48 sm:w-48"
          songs={tracks}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Playlist
          </p>
          <h1 className="mt-2 break-words text-4xl font-black text-white sm:text-5xl">
            {playlist.data.name}
          </h1>
          {playlist.data.description && (
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              {playlist.data.description}
            </p>
          )}
          <p className="mt-3 text-sm text-zinc-500">
            {songIds.length} {songIds.length === 1 ? "song" : "songs"} ·{" "}
            {formatTotalDuration(totalDuration)}
          </p>
        </div>
      </header>

      <PlaylistActions
        deleteOpen={deleteOpen}
        deletePending={removePlaylist.isPending}
        editDescription={editDescription}
        editName={editName}
        editOpen={editOpen}
        editPending={editPlaylist.isPending}
        hasTracks={tracks.length > 0}
        name={playlist.data.name}
        onDelete={() => removePlaylist.mutate()}
        onDeleteOpenChange={setDeleteOpen}
        onEditDescriptionChange={setEditDescription}
        onEditNameChange={setEditName}
        onEditOpenChange={setEditOpen}
        onOpenEdit={openEdit}
        onPlay={() => playFrom(0)}
        onSubmitEdit={submitEdit}
      />
      <PlaylistTracks
        onPlay={playFrom}
        onRemove={(songId) => remove.mutate(songId)}
        tracks={tracks}
      />
    </section>
  );
}

function formatTotalDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  if (hours > 0) return `${hours} hr ${minutes} min`;
  const remainder = wholeSeconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function PlaylistMessage({
  body,
  onRetry,
  title,
}: {
  body: string;
  onRetry?: () => void;
  title: string;
}) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-5 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{body}</p>
        <div className="mt-5 flex justify-center gap-2">
          {onRetry && (
            <Button onClick={onRetry} variant="outline">
              Try again
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/library?view=playlists">Back to playlists</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
