import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from "@music/ui/components/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@music/ui/components/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow
} from "@music/ui/components/table";

import getSession from "@/lib/Authentication/JWT/getSession";
import { addSongToPlaylist, getPlaylists, PlaylistsResponse, getSongInfo } from "@music/sdk";
import { CircleArrowUp, CirclePlus, ExternalLink, ListEnd, Plus, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import Bars3Left from "../Icons/Bars3Left";
import { usePlayer } from "./Player/usePlayer";
import { LibrarySong } from "@music/sdk/types";

type SongContextMenuProps = {
  children: React.ReactNode;
  song_name: string;
  song_id: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_name: string;
};

export default function SongContextMenu({
  children,
  song_name,
  song_id,
  artist_id,
  artist_name,
  album_id,
  album_name,
}: SongContextMenuProps) {
  const [playlists, setPlaylists] = useState<PlaylistsResponse[] | null>(null);
  const [songInfo, setSongInfo] = useState<LibrarySong | null>(null);

  useEffect(() => {
    const getPlaylistsRequest = async () => {
      const session = getSession();
      let playlists = await getPlaylists(Number(session?.sub) ?? 0);
      setPlaylists(playlists);
    };
    getPlaylistsRequest();
  }, []);

  const [isPending, startTransition] = useTransition();

  const { addToQueue } = usePlayer();

  const handleViewProperties = async () => {
    const songInfo = await getSongInfo(song_id);
    setSongInfo(songInfo);
  };

  return (
    <Dialog>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

        <ContextMenuContent className="w-64">
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Plus className="size-5" />
              <p className="pl-3">Add to Playlist</p>
            </ContextMenuSubTrigger>
            {playlists && playlists.length !== 0 && (
              <ContextMenuSubContent className="w-48">
                {playlists?.map((playlist) => (
                  <div key={playlist.name}>
                    <ContextMenuItem onClick={() => addSongToPlaylist(playlist.id, song_id)}>
                      {playlist.name}
                    </ContextMenuItem>
                  </div>
                ))}
              </ContextMenuSubContent>
            )}
          </ContextMenuSub>

          <ContextMenuItem onClick={() => addToQueue({ name: song_name, id: song_id }, { id: album_id, name: album_name }, { id: artist_id, name: artist_name })}>
            <ListEnd className="size-5" />
            <p className="pl-3">Add to Queue</p>
          </ContextMenuItem>

          <ContextMenuItem>
            <CirclePlus className="size-5" />
            <p className="pl-3">Add to Liked</p>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <Link href={`/artist?id=${artist_id}`}>
            <ContextMenuItem>
              <UserRoundSearch className="size-5" />
              <p className="pl-3">Go to Artist</p>
            </ContextMenuItem>
          </Link>

          <ContextMenuItem>
            <CircleArrowUp className="size-5" />
            <p className="pl-3">Go to Album</p>
          </ContextMenuItem>

          <ContextMenuItem>
            <Bars3Left className="size-5" />
            <p className="pl-3">View Credits</p>
          </ContextMenuItem>

          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink className="size-5" />
              <p className="pl-3">Share</p>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem>Copy Song Link</ContextMenuItem>
              <ContextMenuItem>Embed track</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <DialogTrigger asChild>
            <ContextMenuItem onClick={handleViewProperties}>
              <CirclePlus className="size-5" />
              <p className="pl-3">View Properties</p>
            </ContextMenuItem>
          </DialogTrigger>
        </ContextMenuContent>
      </ContextMenu>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-black">Song Information</DialogTitle>
          <Table className="text-black">
            <TableHeader></TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Song Name</TableCell>
                <TableCell>{songInfo?.name ?? song_name}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Artist</TableCell>
                <TableCell>{songInfo?.artist ?? artist_name}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Contributing Artists</TableCell>
                <TableCell>
                  {songInfo?.contributing_artists?.length === 0 ? "N/A" : songInfo?.contributing_artists?.join(", ")}
                </TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Track Number</TableCell>
                <TableCell>{songInfo?.track_number ?? "N/A"}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">ID</TableCell>
                <TableCell>{songInfo?.id ?? song_id}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}