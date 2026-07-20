import {
  addAlbumToPlaylist,
  addSongToPlaylist,
  createPlaylist,
  getPlaylists,
} from "@parson/music-sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { palette } from "@/constants/colors";

export function PlaylistPicker({
  albumId,
  onClose,
  open,
  songId,
}: {
  albumId?: string;
  onClose: () => void;
  open: boolean;
  songId?: string;
}) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: getPlaylists,
    enabled: open,
  });
  const add = async (id: number) => {
    if (addingTo !== null) return;
    setError("");
    setAddingTo(id);
    try {
      if (songId) await addSongToPlaylist(id, songId);
      else if (albumId) await addAlbumToPlaylist(id, albumId);
      onClose();
      void client.invalidateQueries({ queryKey: ["playlists"] });
    } catch {
      setError("Could not add this music to the playlist.");
    } finally {
      setAddingTo(null);
    }
  };
  const create = async () => {
    if (!name.trim() || creatingPlaylist) return;
    setError("");
    setCreatingPlaylist(true);
    try {
      await createPlaylist(
        name.trim(),
        songId ? [songId] : [],
        songId ? undefined : albumId,
      );
      setName("");
      setCreating(false);
      onClose();
      void client.invalidateQueries({ queryKey: ["playlists"] });
    } catch {
      setError("Could not create the playlist.");
    } finally {
      setCreatingPlaylist(false);
    }
  };
  return (
    <ActionDrawer open={open} onClose={onClose} title="Add to playlist">
      {playlists.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color="white" />
          <Text style={styles.loadingText}>Loading playlists…</Text>
        </View>
      ) : null}
      {playlists.isError ? (
        <DrawerAction
          icon={RefreshCw}
          label="Try loading again"
          onPress={() => void playlists.refetch()}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {playlists.data?.map((playlist) => (
        <DrawerAction
          key={playlist.id}
          icon={ListPlus}
          label={addingTo === playlist.id ? "Adding…" : playlist.name}
          onPress={() => void add(playlist.id)}
        />
      ))}
      {creating ? (
        <View style={styles.create}>
          <TextInput
            accessibilityLabel="Playlist name"
            autoFocus
            placeholder="Playlist name"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void create()}
          />
          <Pressable
            accessibilityRole="button"
            disabled={creatingPlaylist || !name.trim()}
            style={[
              styles.button,
              (creatingPlaylist || !name.trim()) && styles.disabled,
            ]}
            onPress={() => void create()}
          >
            <Text style={styles.buttonText}>
              {creatingPlaylist ? "Creating…" : "Create"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <DrawerAction
          icon={Plus}
          label="New playlist"
          onPress={() => setCreating(true)}
        />
      )}
    </ActionDrawer>
  );
}

const styles = StyleSheet.create({
  loading: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  loadingText: { color: palette.secondary },
  create: { flexDirection: "row", gap: 8, padding: 10 },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#29292e",
    color: "white",
    paddingHorizontal: 13,
  },
  button: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "white",
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  buttonText: { color: "black", fontWeight: "800" },
  disabled: { opacity: 0.45 },
  error: { color: "#ff9b9b", paddingHorizontal: 16, paddingVertical: 8 },
});
