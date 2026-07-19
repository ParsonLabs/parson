"use client";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePlayer } from "@/features/player/player-context";
import { getAlbumInfo, type LibraryAlbum } from "@parson/music-sdk";
import { Disc3, Download, Play, UserRound } from "lucide-react";
import { downloadAlbum } from "@/lib/downloads/download-album";
import { toast } from "sonner";
import Link from "next/link";

type AlbumMenuProps = {
  album_id: string;
  artist_id: string;
  children: React.ReactNode;
  showArtist?: boolean;
};

export default function AlbumMenu({
  album_id,
  artist_id,
  children,
  showArtist = true,
}: AlbumMenuProps) {
  const player = usePlayer();

  const loadAlbum = () =>
    getAlbumInfo(album_id, false) as Promise<LibraryAlbum>;

  const play = async () => {
    const album = await loadAlbum();
    const firstSong = album.songs?.[0];
    const artist = album.artist_object;
    if (!firstSong || !artist) return;
    player.setQueue(album.songs.map((song) => ({ song, album, artist })));
    player.setCurrentSongIndex(0);
    player.setSongCallback(firstSong, artist, album);
    player.playAudioSource();
  };

  const save = async () => {
    const album = await loadAlbum();
    const count = downloadAlbum(album);
    if (count) toast.success(`Downloading ${count} songs from ${album.name}`);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => void play()}>
          <Play className="h-4 w-4 fill-current" />
          Play
        </ContextMenuItem>
        <ContextMenuItem asChild>
          <Link href={`/album?id=${album_id}`}>
            <Disc3 className="h-4 w-4" />
            View album
          </Link>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void save()}>
          <Download className="h-4 w-4" />
          Download album
        </ContextMenuItem>
        {showArtist && (
          <ContextMenuItem asChild>
            <Link href={`/artist?id=${artist_id}`}>
              <UserRound className="h-4 w-4" />
              View artist
            </Link>
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
