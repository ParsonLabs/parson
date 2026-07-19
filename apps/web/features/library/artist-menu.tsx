"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePlayer } from "@/features/player/player-context";
import { getArtistInfo } from "@parson/music-sdk";
import { Play, UserRound } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

export default function ArtistMenu({
  artistId,
  children,
}: {
  artistId: string;
  children: React.ReactNode;
}) {
  const player = usePlayer();

  const play = async () => {
    try {
      const artist = await getArtistInfo(artistId);
      const seen = new Set<string>();
      const queue = artist.albums.flatMap((album) =>
        album.songs
          .filter((song) => {
            if (seen.has(song.id)) return false;
            seen.add(song.id);
            return true;
          })
          .map((song) => ({ song, album, artist })),
      );
      const first = queue[0];
      if (!first) return;
      player.setQueue(queue);
      player.setCurrentSongIndex(0);
      player.setSongCallback(first.song, artist, first.album);
      player.playAudioSource();
    } catch {
      toast("Could not play this artist.");
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
          <Link href={`/artist?id=${artistId}`}>
            <UserRound className="h-4 w-4" />
            Go to artist
          </Link>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
