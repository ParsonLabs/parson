import { getArtistInfo } from "@parson/music-sdk";
import { Play, UserRound } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useState } from "react";

import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { usePlayer } from "@/providers/player-provider";

export function ArtistActions({
  artistId,
  name,
  onClose,
  open,
}: {
  artistId: string;
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
          loading ? "Loading artist…" : failed ? "Try playing again" : "Play"
        }
        onPress={() => {
          if (loading) return;
          setFailed(false);
          setLoading(true);
          void getArtistInfo(artistId)
            .then((artist) => {
              const songs = artist.albums.flatMap((album) => album.songs);
              if (songs[0]) player.playSong(songs[0], songs);
              onClose();
            })
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
        }}
      />
      <DrawerAction
        icon={UserRound}
        label="Go to artist"
        onPress={() => {
          onClose();
          router.push(`/artist/${artistId}`);
        }}
      />
    </ActionDrawer>
  );
}
