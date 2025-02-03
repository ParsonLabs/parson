"use client";

import { useEffect, useState } from "react";
import { getPlaylist, getPlaylists, getUserInfoById } from "@music/sdk";
import { Playlist as OriginalPlaylist } from "@music/sdk/types";
import { Button } from "@music/ui/components/button";
import { ListMusic, Plus, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSession } from "../Providers/AuthProvider";
import CreatePlaylistDialog from "../Music/Playlist/CreatePlaylistDialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@music/ui/components/accordion";

interface Playlist extends OriginalPlaylist {
  users: string[];
}

export default function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { session } = useSession();

  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        setError(null);
        
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load playlists');
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [session?.sub]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-white/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 text-sm px-4 py-2">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="px-4">
        <CreatePlaylistDialog>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sm text-white/90
              hover:bg-white/10 hover:text-white
              active:bg-white/20
              backdrop-blur-sm
              transition-all duration-200
              border border-white/10
              rounded-lg
              py-2"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Playlist
          </Button>
        </CreatePlaylistDialog>
      </div>

      {playlists && playlists.length > 0 && (
        <Accordion type="single" collapsible className="px-2">
          <AccordionItem value="playlists" className="border-none">
            <AccordionTrigger className="hover:bg-white/5 rounded-lg px-2 py-2 transition-all">
              <div className="flex items-center gap-2">
                <ListMusic className="h-4 w-4" />
                <span className="font-medium text-sm">Your Playlists</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1 px-2">
                {playlists.map((playlist) => (
                  <Link 
                    href={`/playlist?id=${playlist.id}`} 
                    key={playlist.id}
                    className="group flex items-start gap-3 px-3 py-2 rounded-md hover:bg-white/5 transition-colors"
                  >
                    <ListMusic className="h-4 w-4 mt-1 text-neutral-400 group-hover:text-white" />
                    <div>
                      <p className="text-sm text-neutral-200 group-hover:text-white">
                        {playlist.name}
                      </p>
                      <p className="text-xs text-neutral-400">
                        Playlist • {playlist.users.join(", ")}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}