"use client";

import getSession from "@/lib/Authentication/JWT/getSession";
import { getPlaylist, getPlaylists, getUserInfoById } from "@music/sdk";
import { Playlist as OriginalPlaylist } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import { ListMusic, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import CreatePlaylistDialog from "../Music/Playlist/CreatePlaylistDialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@music/ui/components/accordion";
import { useSession } from "../Providers/AuthProvider";

interface Playlist extends OriginalPlaylist {
  users: string[];
}

export default function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const { session } = useSession();

  useEffect(() => {
    async function fetchData() {
      const playlistsData = await getPlaylists((Number(session?.sub)) ?? 0);

      const transformedPlaylists: Playlist[] = await Promise.all(
        playlistsData.map(async (playlist: any) => {
          const playlistInfo = await getPlaylist(playlist.id);
          const users = await Promise.all(
            playlistInfo.user_ids.map(async (userId: number) => {
              const userInfo = await getUserInfoById(userId);
              return userInfo.username;
            })
          );
          return {
            ...playlist,
            createdAt: new Date(playlist.createdAt),
            updatedAt: new Date(playlist.updatedAt),
            users: users,
          };
        })
      );

      setPlaylists(transformedPlaylists);
    }
    fetchData();
  }, [session?.sub]);

  return (
    <div>
      {playlists && playlists.length > 0 ? (
        <Accordion type="single" collapsible>
          <AccordionItem value="playlists">
            <AccordionTrigger className="font-heading text-white font-semibold text-sm">
              <ListMusic className="h-6 w-6 ml-4 mr-4" />
              Playlists
            </AccordionTrigger>
            <AccordionContent>
              {playlists.map((playlist) => (
                <div className="pl-5 text-sm flex flex-row items-center gap-3 py-2" key={playlist.id}>
                  <ListMusic className="size-4" />
                  <Link href={"/playlist?id=" + playlist.id} key={playlist.id}>
                    <p className="text-sm" key={playlist.id}>{playlist.name}</p>
                    <p className="text-xs font-thin">Playlist • {playlist.users.join(", ")}</p>
                  </Link>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <div className="mt-6 flex justify-center">
          <CreatePlaylistDialog>
            <Button style={{ backgroundColor: "#353535" }}>
              <Plus className="mr-2 h-4 w-4" />
              Create Playlist
            </Button>
          </CreatePlaylistDialog>
        </div>
      )}
    </div>
  );
}