"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { createPlaylist, type PlaylistSummary } from "@parson/music-sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

export default function CreatePlaylistDialog({
  initialAlbumId,
  initialSongIds,
  onCreated,
  onOpenChange,
  open,
}: {
  initialAlbumId?: string;
  initialSongIds?: string[] | (() => Promise<string[]>);
  onCreated?: (playlist: PlaylistSummary) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async (playlistName: string) => {
      const songIds =
        typeof initialSongIds === "function"
          ? await initialSongIds()
          : (initialSongIds ?? []);
      return createPlaylist(playlistName, songIds, initialAlbumId);
    },
    onSuccess: async (playlist) => {
      queryClient.setQueryData<PlaylistSummary[]>(["playlists"], (current) =>
        current
          ? [playlist, ...current.filter((item) => item.id !== playlist.id)]
          : [playlist],
      );
      toast.success(`Created ${playlist.name}`);
      setName("");
      onOpenChange(false);
      if (onCreated) {
        void Promise.resolve(onCreated(playlist)).catch(() => undefined);
      }
    },
    onError: () => toast("Could not create the playlist."),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = name.trim();
    if (value) create.mutate(value);
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!create.isPending) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="new-playlist-name">Name</FieldLabel>
            <Input
              id="new-playlist-name"
              aria-label="Playlist name"
              autoFocus
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              placeholder="My playlist"
              value={name}
            />
          </Field>
          <Button
            className="w-full bg-white text-black hover:bg-zinc-200"
            disabled={!name.trim() || create.isPending}
            type="submit"
          >
            {create.isPending ? "Creating…" : "Create playlist"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
