"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SongMenu from "@/features/library/song-menu";
import { formatDuration } from "@/features/library/library-view-primitives";
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import type { LibrarySong } from "@parson/music-sdk/types";
import {
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { moveItem, playlistDropIndex } from "./playlist-playback";

export function PlaylistPlaybackActions({
  hasTracks,
  name,
  onPlay,
  onShuffle,
}: {
  hasTracks: boolean;
  name: string;
  onPlay: () => void;
  onShuffle: () => void;
}) {
  return (
    <>
      <Button
        aria-label={`Play ${name}`}
        className="h-12 w-12 rounded-full bg-white p-0 text-black hover:bg-zinc-200"
        disabled={!hasTracks}
        onClick={onPlay}
      >
        <Play className="ml-0.5 h-5 w-5 fill-current" />
      </Button>
      <Button
        aria-label={`Shuffle ${name}`}
        className="h-10 w-10 rounded-full text-zinc-400 hover:text-white"
        disabled={!hasTracks}
        onClick={onShuffle}
        size="icon"
        variant="ghost"
      >
        <Shuffle className="h-5 w-5" />
      </Button>
    </>
  );
}

export function PlaylistActions({
  deleteOpen,
  deletePending,
  editName,
  editOpen,
  editPending,
  hasTracks,
  name,
  onDelete,
  onDeleteOpenChange,
  onEditNameChange,
  onEditOpenChange,
  onOpenEdit,
  onPlay,
  onShuffle,
  onSubmitEdit,
}: {
  deleteOpen: boolean;
  deletePending: boolean;
  editName: string;
  editOpen: boolean;
  editPending: boolean;
  hasTracks: boolean;
  name: string;
  onDelete: () => void;
  onDeleteOpenChange: (open: boolean) => void;
  onEditNameChange: (value: string) => void;
  onEditOpenChange: (open: boolean) => void;
  onOpenEdit: () => void;
  onPlay: () => void;
  onShuffle: () => void;
  onSubmitEdit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <PlaylistPlaybackActions
        hasTracks={hasTracks}
        name={name}
        onPlay={onPlay}
        onShuffle={onShuffle}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Playlist options" size="icon" variant="ghost">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onSelect={onOpenEdit}>
            <Pencil />
            Edit playlist
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onDeleteOpenChange(true)}>
            <Trash2 />
            Delete playlist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editOpen} onOpenChange={onEditOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit playlist</DialogTitle>
          </DialogHeader>
          <form className="grid gap-5" onSubmit={onSubmitEdit}>
            <Field>
              <FieldLabel htmlFor="playlist-name">Name</FieldLabel>
              <Input
                id="playlist-name"
                maxLength={200}
                onChange={(event) => onEditNameChange(event.target.value)}
                required
                value={editName}
              />
            </Field>
            <DialogFooter>
              <Button disabled={!editName.trim() || editPending} type="submit">
                {editPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={onDeleteOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this playlist?</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={deletePending} onClick={onDelete}>
              <Trash2 />
              {deletePending ? "Deleting…" : "Delete playlist"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PlaylistTracks({
  activeSongId,
  emptyBody = "Add songs from anywhere in your library.",
  emptyTitle = "This playlist is empty",
  isPlaying,
  onPlay,
  onRemove,
  onReorder,
  removeLabel,
  reorderPending = false,
  tracks,
}: {
  activeSongId?: string;
  emptyBody?: string;
  emptyTitle?: string;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  onRemove?: (songId: string) => void;
  onReorder?: (orderedSongIds: string[]) => void;
  removeLabel?: string;
  reorderPending?: boolean;
  tracks: LibrarySong[];
}) {
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    edge: "before" | "after";
    songId: string;
  } | null>(null);
  const trackGridColumns =
    "grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem] sm:grid-cols-[2rem_2.5rem_minmax(0,1fr)_minmax(8rem,0.6fr)_3rem]";
  const moveTrack = (from: number, to: number) => {
    if (!onReorder || from === to || from < 0 || to < 0 || reorderPending)
      return;
    onReorder(
      moveItem(
        tracks.map((song) => song.id),
        from,
        to,
      ),
    );
  };
  const dropTrack = (
    from: number,
    targetIndex: number,
    edge: "before" | "after",
  ) => {
    moveTrack(from, playlistDropIndex(tracks.length, from, targetIndex, edge));
  };
  const moveWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    index: number,
  ) => {
    if (event.currentTarget !== event.target) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    moveTrack(index, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  return (
    <div
      aria-label={
        onReorder ? "Playlist tracks. Drag rows to reorder." : undefined
      }
      className="mt-7 overflow-hidden rounded-xl border border-white/[0.08]"
      role={onReorder ? "list" : undefined}
    >
      {!tracks.length && (
        <div className="px-5 py-12 text-center">
          <p className="font-medium text-zinc-200">{emptyTitle}</p>
          <p className="mt-2 text-sm text-zinc-500">{emptyBody}</p>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/library?view=songs">Browse songs</Link>
          </Button>
        </div>
      )}
      {tracks.map((song, index) => {
        const active = activeSongId === song.id;
        return (
          <SongMenu
            album_id={song.album_object.id}
            album_name={song.album_object.name}
            album_cover={song.album_object.cover_url}
            artist_id={song.artist_object.id}
            artist_name={song.artist_object.name}
            key={song.id}
            onRemoveFromPlaylist={
              onRemove ? () => onRemove(song.id) : undefined
            }
            removeFromPlaylistLabel={removeLabel}
            song_id={song.id}
            song_name={song.name}
          >
            <div
              aria-label={
                onReorder
                  ? `${song.name}. Drag to reorder, or use the arrow keys.`
                  : undefined
              }
              className={`group relative grid ${trackGridColumns} items-center gap-3 border-b border-white/[0.06] px-3 py-2 transition-colors last:border-0 hover:bg-white/[0.035] ${
                onReorder
                  ? "cursor-grab focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30 active:cursor-grabbing"
                  : ""
              } ${active ? "bg-white/[0.02]" : ""} ${
                draggedSongId === song.id ? "bg-white/[0.06] opacity-60" : ""
              }`}
              data-native-drag={onReorder ? "true" : undefined}
              draggable={Boolean(onReorder) && !reorderPending}
              onDragEnd={() => {
                setDraggedSongId(null);
                setDropTarget(null);
              }}
              role={onReorder ? "listitem" : undefined}
              onDragStart={(event) => {
                if (!onReorder || reorderPending) {
                  event.preventDefault();
                  return;
                }
                setDraggedSongId(song.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", song.id);
              }}
              onDragOver={(event) => {
                if (!draggedSongId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropTarget({
                  edge:
                    event.clientY < bounds.top + bounds.height / 2
                      ? "before"
                      : "after",
                  songId: song.id,
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId =
                  draggedSongId || event.dataTransfer.getData("text/plain");
                const from = tracks.findIndex((track) => track.id === sourceId);
                const bounds = event.currentTarget.getBoundingClientRect();
                const edge =
                  event.clientY < bounds.top + bounds.height / 2
                    ? "before"
                    : "after";
                dropTrack(from, index, edge);
                setDraggedSongId(null);
                setDropTarget(null);
              }}
              onKeyDown={(event) => moveWithKeyboard(event, index)}
              tabIndex={onReorder ? 0 : undefined}
            >
              {dropTarget?.songId === song.id && draggedSongId !== song.id && (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-3 z-30 h-0.5 rounded-full bg-white ${
                    dropTarget.edge === "before" ? "top-0" : "bottom-0"
                  }`}
                />
              )}
              <button
                aria-label={`${active && isPlaying ? "Pause" : "Play"} ${song.name}`}
                className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
                onClick={() => onPlay(index)}
                type="button"
              />
              <span className="pointer-events-none relative z-10 text-center text-sm tabular-nums text-zinc-500">
                <span className={active ? "block" : "group-hover:hidden"}>
                  {active ? (
                    <>
                      {isPlaying ? (
                        <Pause
                          aria-hidden="true"
                          className="mx-auto h-4 w-4 fill-white text-white"
                        />
                      ) : (
                        <Play
                          aria-hidden="true"
                          className="mx-auto h-4 w-4 fill-white text-white"
                        />
                      )}
                      <span className="sr-only">
                        {isPlaying ? "Now playing" : "Current track"}
                      </span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                {!active && (
                  <Play
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white text-white group-hover:block"
                  />
                )}
              </span>
              <div className="pointer-events-none relative z-10 h-10 w-10 overflow-hidden rounded-md bg-zinc-900">
                <Image
                  alt=""
                  className="object-cover"
                  draggable={false}
                  fill
                  sizes="40px"
                  src={
                    song.album_object.cover_url
                      ? `${getBaseURL()}/media/images/${encodeURIComponent(song.album_object.cover_url)}`
                      : defaultCover
                  }
                />
              </div>
              <div className="pointer-events-none relative z-10 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {song.name}
                </p>
                <Link
                  className="pointer-events-auto relative z-20 text-xs text-zinc-500 hover:text-white hover:underline"
                  draggable={false}
                  href={`/artist?id=${song.artist_object.id}`}
                >
                  {song.artist_object.name}
                </Link>
              </div>
              <Link
                className="relative z-20 hidden truncate text-sm text-zinc-500 hover:text-white hover:underline sm:block"
                draggable={false}
                href={`/album?id=${song.album_object.id}`}
              >
                {song.album_object.name}
              </Link>
              <span className="pointer-events-none relative z-10 justify-self-end text-xs tabular-nums text-zinc-500">
                {formatDuration(song.duration)}
              </span>
            </div>
          </SongMenu>
        );
      })}
    </div>
  );
}
