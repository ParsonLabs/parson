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
import { addSongToPlaylist, getPlaylists, PlaylistsResponse } from "@music/sdk";
import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { CircleArrowUp, CirclePlus, ExternalLink, ListEnd, Plus, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import Bars3Left from "../Icons/Bars3Left";
import { usePlayer } from "./Player/usePlayer";

export default function SongContextMenu({
  children,
  song,
  artist,
  album,
}: {
  children: React.ReactNode;
  song: LibrarySong;
  artist: Artist;
  album: Album;
}) {
  const [playlists, setPlaylists] = useState<PlaylistsResponse[] | null>(null);

  useEffect(() => {
    const getPlaylistsRequest = async () => {
        const session = getSession()
        let playlists = await getPlaylists(Number(session?.sub) ?? 0)
        setPlaylists(playlists);
      }
    getPlaylistsRequest();
  }, []);

  const [isPending, startTransition] = useTransition()

  const { addToQueue } = usePlayer()

  return (
    <Dialog>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

        <ContextMenuContent className="w-64">
          <ContextMenuSub>
            <ContextMenuSubTrigger >
              <Plus className="size-5"/>
              <p className="pl-3">Add to Playlist</p>
            </ContextMenuSubTrigger>
            {playlists && playlists.length !== 0 && (
              <ContextMenuSubContent className="w-48">
                {playlists?.map((playlist) => (
                  <div key={playlist.name}>
                    <ContextMenuItem onClick={() => addSongToPlaylist(playlist.id, song.id)}>{playlist.name}</ContextMenuItem>
                  </div>
                ))}
              </ContextMenuSubContent>
            )}
          </ContextMenuSub>

          <ContextMenuItem onClick={() => addToQueue(song, album, artist)}>
            <ListEnd className="size-5"/>
            <p className="pl-3">Add to Queue</p>
          </ContextMenuItem>

          <ContextMenuItem>
            <CirclePlus className="size-5"/>
            <p className="pl-3">Add to Liked</p>
          </ContextMenuItem>

          <ContextMenuSeparator />

          <Link href={`/artist?id=${artist.id}`}>
            <ContextMenuItem>
              <UserRoundSearch className="size-5"/>
              <p className="pl-3">Go to Artist</p>
            </ContextMenuItem>
          </Link>

          <ContextMenuItem>
            <CircleArrowUp className="size-5"/>
            <p className="pl-3">Go to Album</p>
          </ContextMenuItem>

          <ContextMenuItem>
            <Bars3Left className="size-5"/>
            <p className="pl-3">View Credits</p>
          </ContextMenuItem>

          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink className="size-5"/>
              <p className="pl-3">Share</p>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              <ContextMenuItem>Copy Song Link</ContextMenuItem>
              <ContextMenuItem>Embed track</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>

          <DialogTrigger asChild>
            <ContextMenuItem>
              <CirclePlus className="size-5"/>
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
                <TableCell>{song.name}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Artist</TableCell>
                <TableCell>{song.artist}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">
                  Contributing Artists
                </TableCell>
                <TableCell>
                  {song.contributing_artists.length === 0
                    ? "N/A"
                    : song.contributing_artists.join(", ")}
                </TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">Track Number</TableCell>
                <TableCell>{song.track_number}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell className="font-medium">ID</TableCell>
                <TableCell>{song.id}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
