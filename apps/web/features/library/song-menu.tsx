"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import CreatePlaylistDialog from "@/features/library/create-playlist-dialog";
import { usePlayer } from "@/features/player/player-context";
import { addSongToPlaylist, getPlaylists } from "@parson/music-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Disc3,
  ListEnd,
  ListPlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { songMenuQueueItem } from "./song-menu-state";

type SongMenuProps = {
  children: React.ReactNode;
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
  album_cover?: string;
  context?: "default" | "home" | "artist";
  onRemoveFromPlaylist?: () => void;
};

export default function SongMenu({
  children,
  song_name,
  song_id,
  artist_id,
  artist_name,
  album_id,
  album_name,
  album_cover,
  context = "default",
  onRemoveFromPlaylist,
}: SongMenuProps) {
  const player = usePlayer();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: getPlaylists,
    enabled: open,
  });
  const addToPlaylist = useMutation({
    mutationFn: ({ id }: { id: number; name: string }) =>
      addSongToPlaylist(id, song_id),
    onSuccess: async (_, playlist) => {
      toast.success(`Added to ${playlist.name}`);
      await queryClient.invalidateQueries({
        queryKey: ["playlist", playlist.id],
        refetchType: "none",
      });
      await queryClient.invalidateQueries({
        queryKey: ["playlists"],
        refetchType: "none",
      });
    },
    onError: () => toast("Could not add this song."),
  });

  const queueItem = () => {
    return songMenuQueueItem({
      songId: song_id,
      songName: song_name,
      artistId: artist_id,
      artistName: artist_name,
      albumId: album_id,
      albumName: album_name,
      albumCover: album_cover,
    });
  };

  const play = () => {
    const item = queueItem();
    player.setQueue([item]);
    player.setCurrentSongIndex(0);
    player.setSongCallback(item.song, item.artist, item.album);
    player.playAudioSource();
  };

  const addToQueue = () => {
    player.addToQueue([queueItem()]);
    toast.success(`Added ${song_name} to queue`);
  };

  const playNext = () => {
    player.addNextToQueue([queueItem()]);
    toast.success(`${song_name} will play next`);
  };

  return (
    <>
      <ContextMenu onOpenChange={setOpen}>
        <ContextMenuTrigger
          aria-description="Right-click or long press for song actions"
          asChild
          title="Right-click or long press for song actions"
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={play}>
            <Play className="h-4 w-4 fill-current" />
            Play
          </ContextMenuItem>
          {context === "default" && (
            <ContextMenuItem onSelect={playNext}>
              <ListPlus className="h-4 w-4" />
              Play next
            </ContextMenuItem>
          )}
          {context !== "artist" && (
            <ContextMenuItem onSelect={addToQueue}>
              <ListEnd className="h-4 w-4" />
              Add to queue
            </ContextMenuItem>
          )}
          <ContextMenuItem asChild>
            <Link href={`/album?id=${album_id}`}>
              <Disc3 className="h-4 w-4" />
              View album
            </Link>
          </ContextMenuItem>
          {context !== "artist" && (
            <ContextMenuItem asChild>
              <Link href={`/artist?id=${artist_id}`}>
                <UserRound className="h-4 w-4" />
                View artist
              </Link>
            </ContextMenuItem>
          )}
          {context !== "artist" && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <ListPlus className="h-4 w-4" />
                Add to playlist
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                {playlists.isPending && (
                  <ContextMenuItem disabled>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading playlists…
                  </ContextMenuItem>
                )}
                {playlists.isError && (
                  <ContextMenuItem onSelect={() => void playlists.refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    Try loading again
                  </ContextMenuItem>
                )}
                {playlists.data?.map((playlist) => (
                  <ContextMenuItem
                    disabled={addToPlaylist.isPending}
                    key={playlist.id}
                    onSelect={() =>
                      addToPlaylist.mutate({
                        id: playlist.id,
                        name: playlist.name,
                      })
                    }
                  >
                    <ListPlus className="h-4 w-4" />
                    <span className="truncate">{playlist.name}</span>
                  </ContextMenuItem>
                ))}
                {playlists.isSuccess && (
                  <ContextMenuItem onSelect={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    New playlist
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {onRemoveFromPlaylist && (
            <ContextMenuItem
              data-variant="destructive"
              onSelect={onRemoveFromPlaylist}
            >
              <X className="h-4 w-4" />
              Remove from playlist
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <CreatePlaylistDialog
        initialSongIds={[song_id]}
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </>
  );
}
