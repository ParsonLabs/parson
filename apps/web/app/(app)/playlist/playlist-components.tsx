"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import getBaseURL from "@/lib/api/server-url";
import { defaultCover } from "@/lib/images/default-cover";
import type { LibrarySong } from "@parson/music-sdk/types";
import { MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FormEvent } from "react";

export function PlaylistActions({
  deleteOpen,
  deletePending,
  editDescription,
  editName,
  editOpen,
  editPending,
  hasTracks,
  name,
  onDelete,
  onDeleteOpenChange,
  onEditDescriptionChange,
  onEditNameChange,
  onEditOpenChange,
  onOpenEdit,
  onPlay,
  onSubmitEdit,
}: {
  deleteOpen: boolean;
  deletePending: boolean;
  editDescription: string;
  editName: string;
  editOpen: boolean;
  editPending: boolean;
  hasTracks: boolean;
  name: string;
  onDelete: () => void;
  onDeleteOpenChange: (open: boolean) => void;
  onEditDescriptionChange: (value: string) => void;
  onEditNameChange: (value: string) => void;
  onEditOpenChange: (open: boolean) => void;
  onOpenEdit: () => void;
  onPlay: () => void;
  onSubmitEdit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <Button
        aria-label={`Play ${name}`}
        className="h-12 w-12 rounded-full bg-white p-0 text-black hover:bg-zinc-200"
        disabled={!hasTracks}
        onClick={onPlay}
      >
        <Play className="ml-0.5 h-5 w-5 fill-current" />
      </Button>
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
            <Field>
              <FieldLabel htmlFor="playlist-description">
                Description
              </FieldLabel>
              <Textarea
                id="playlist-description"
                maxLength={5000}
                onChange={(event) =>
                  onEditDescriptionChange(event.target.value)
                }
                placeholder="Optional"
                value={editDescription}
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
  onPlay,
  onRemove,
  tracks,
}: {
  onPlay: (index: number) => void;
  onRemove: (songId: string) => void;
  tracks: LibrarySong[];
}) {
  return (
    <div className="mt-7 overflow-hidden rounded-xl border border-white/[0.08]">
      {!tracks.length && (
        <div className="px-5 py-12 text-center">
          <p className="font-medium text-zinc-200">This playlist is empty</p>
          <p className="mt-2 text-sm text-zinc-500">
            Right-click or long-press any song, then choose Add to playlist.
          </p>
          <Button asChild className="mt-5" variant="outline">
            <Link href="/library?view=songs">Browse songs</Link>
          </Button>
        </div>
      )}
      {tracks.map((song, index) => (
        <SongMenu
          album_id={song.album_object.id}
          album_name={song.album_object.name}
          album_cover={song.album_object.cover_url}
          artist_id={song.artist_object.id}
          artist_name={song.artist_object.name}
          key={song.id}
          onRemoveFromPlaylist={() => onRemove(song.id)}
          song_id={song.id}
          song_name={song.name}
        >
          <div className="group relative grid grid-cols-[2rem_2.5rem_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.06] px-3 py-2 last:border-0 hover:bg-white/[0.035] sm:grid-cols-[2rem_2.5rem_minmax(0,1fr)_minmax(8rem,0.6fr)]">
            <button
              aria-label={`Play ${song.name}`}
              className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/30"
              onClick={() => onPlay(index)}
              type="button"
            />
            <span className="pointer-events-none relative z-10 text-center text-sm tabular-nums text-zinc-500">
              {index + 1}
            </span>
            <div className="pointer-events-none relative z-10 h-10 w-10 overflow-hidden rounded-md bg-zinc-900">
              <Image
                alt=""
                className="object-cover transition-opacity group-hover:opacity-40"
                fill
                sizes="40px"
                src={
                  song.album_object.cover_url
                    ? `${getBaseURL()}/media/images/${encodeURIComponent(song.album_object.cover_url)}`
                    : defaultCover
                }
              />
              <Play className="absolute left-1/2 top-1/2 hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 fill-white group-hover:block" />
            </div>
            <div className="pointer-events-none relative z-10 min-w-0">
              <p className="truncate text-sm font-medium text-zinc-200">
                {song.name}
              </p>
              <Link
                className="pointer-events-auto relative z-20 text-xs text-zinc-500 hover:text-white hover:underline"
                href={`/artist?id=${song.artist_object.id}`}
              >
                {song.artist_object.name}
              </Link>
            </div>
            <Link
              className="relative z-20 hidden truncate text-sm text-zinc-500 hover:text-white hover:underline sm:block"
              href={`/album?id=${song.album_object.id}`}
            >
              {song.album_object.name}
            </Link>
          </div>
        </SongMenu>
      ))}
    </div>
  );
}
