import { getPlaylist } from "@parson/music-sdk";
import { ListMusic, Play } from "lucide-react-native";
import { useRouter } from "expo-router";

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
  return (
    <ActionDrawer open={open} onClose={onClose} title={name}>
      <DrawerAction
        icon={Play}
        label="Play"
        onPress={() => {
          onClose();
          void getPlaylist(playlistId).then((playlist) => {
            if (playlist.songs[0])
              player.playSong(playlist.songs[0], playlist.songs);
          });
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
