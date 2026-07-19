"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePlayer } from "@/features/player/player-context";
import { getPlaylist } from "@parson/music-sdk";
import { ListMusic, Play } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function PlaylistMenu({
  children,
  playlistId,
}: {
  children: React.ReactNode;
  playlistId: number;
}) {
  const player = usePlayer();

  const play = async () => {
    try {
      const playlist = await getPlaylist(playlistId);
      const first = playlist.songs[0];
      if (!first) return;
      player.setQueue(
        playlist.songs.map((song) => ({
          song,
          artist: song.artist_object,
          album: song.album_object,
        })),
      );
      player.setCurrentSongIndex(0);
      player.setSongCallback(first, first.artist_object, first.album_object);
      player.playAudioSource();
    } catch {
      toast("Could not play this playlist.");
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => void play()}>
          <Play className="fill-current" />
          Play
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem asChild>
          <Link href={`/playlist?id=${playlistId}`}>
            <ListMusic className="h-4 w-4" />
            Go to playlist
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
