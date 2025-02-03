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
  DialogTitle, DialogClose,
  DialogFooter
} from "@music/ui/components/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow
} from "@music/ui/components/table";

import { addSongToPlaylist, getPlaylists, PlaylistsResponse, getSongInfo } from "@music/sdk";
import { CircleArrowUp, CirclePlus, ExternalLink, ListEnd, Plus, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import Bars3Left from "../Icons/Bars3Left";
import { usePlayer } from "./Player/usePlayer";
import { LibrarySong, BareSong } from "@music/sdk/types";
import { useSession } from "../Providers/AuthProvider";
import { Button } from "@music/ui/components/button";
import EditSongDialog from "./EditSongDialog";
import { toast } from "sonner";

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
  const [songInfo, setSongInfo] = useState<LibrarySong | BareSong | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { session } = useSession();

  useEffect(() => {
    const getPlaylistsRequest = async () => {
      try {
        if (!session?.sub) return;
        const playlists = await getPlaylists(Number(session.sub));
        setPlaylists(playlists);
      } catch (error) {
        console.error("Failed to fetch playlists:", error);
      }
    };
    getPlaylistsRequest();
  }, [session?.sub]);

  
  const { addToQueue } = usePlayer();
  
  const handleViewProperties = useCallback(async () => {
    const info = await getSongInfo(song_id, true);
    setSongInfo(info as BareSong);
  }, [song_id]);
  const handleOpenChange = useCallback((open: boolean) => {
  if (open) {
    handleViewProperties();
  } else {
    setSongInfo(null);
  }
  setIsDialogOpen(open);
}, [handleViewProperties]);
  
  const handleDialogOpenChange = useCallback((open: boolean) => {
      setIsDialogOpen(true);
      handleViewProperties();
  }, [handleViewProperties]);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

        <ContextMenuContent className="w-64 text-white bg-zinc-950">
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

          <ContextMenuItem onClick={() => { 
            addToQueue(
              { name: song_name, id: song_id }, 
              { id: album_id, name: album_name }, 
              { id: artist_id, name: artist_name }
            ); 
            toast("Added to Queue", {
              description: `${song_name} by ${artist_name} has been added to the queue.`,
            });
          }}>	
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

          <ContextMenuItem onClick={() => setIsDialogOpen(true)}>
            <CirclePlus className="size-5" />
            <p className="pl-3">View Properties</p>
          </ContextMenuItem>

          <EditSongDialog song_id={song_id} />
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-black">Song Information</DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}