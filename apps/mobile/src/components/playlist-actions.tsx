import { getPlaylist } from "@parson/music-sdk";
import { ListMusic, Play } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useState } from "react";

import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { usePlayer } from "@/providers/player-provider";

export function PlaylistActions({
  playlistId,
  name,
  onClose,
  open,
}: {
  playlistId: number;
  name?: string;
  onClose: () => void;
  open: boolean;
}) {
  const router = useRouter();
  const player = usePlayer();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <ActionDrawer open={open} onClose={onClose} title={name}>
      <DrawerAction
        icon={Play}
        label={
          loading ? "Loading playlist…" : failed ? "Try playing again" : "Play"
        }
        onPress={() => {
          if (loading) return;
          setFailed(false);
          setLoading(true);
          void getPlaylist(playlistId)
            .then((playlist) => {
              if (playlist.songs[0])
                player.playSong(playlist.songs[0], playlist.songs);
              onClose();
            })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
        }}
      />
      <DrawerAction
        icon={ListMusic}
        label="Go to playlist"
        onPress={() => {
          onClose();
          router.push(`/playlist/${playlistId}`);
        }}
      />
    </ActionDrawer>
  );
}
