import {
  deletePlaylist,
  getPlaylist,
  removeSongFromPlaylist,
  updatePlaylist,
} from "@parson/music-sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { Artwork } from "@/components/artwork";
import { Screen, SongRow } from "@/components/music-ui";
import { palette } from "@/constants/colors";
import { usePlayer } from "@/providers/player-provider";
import { formatCollectionDuration } from "@/lib/format";

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const player = usePlayer();
  const client = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const query = useQuery({
    queryKey: ["playlist", id],
    queryFn: () => getPlaylist(Number(id)),
    enabled: !!id,
  });
  if (query.isPending)
    return (
      <Screen>
        <ActivityIndicator color="white" style={{ flex: 1 }} />
      </Screen>
    );
  if (!query.data) return <Screen />;
  const data = query.data;
  const removeSong = async (songId: string) => {
    const previous = data;
    const removed = data.songs.find((song) => song.id === songId);
    client.setQueryData<typeof data>(["playlist", id], {
      ...data,
      songs: data.songs.filter((song) => song.id !== songId),
      song_count: Math.max(0, data.song_count - 1),
      total_duration: Math.max(
        0,
        data.total_duration - (removed?.duration ?? 0),
      ),
    });
    try {
      await removeSongFromPlaylist(data.id, songId);
      void client.invalidateQueries({ queryKey: ["playlist", id] });
      void client.invalidateQueries({ queryKey: ["playlists"] });
    } catch {
      client.setQueryData(["playlist", id], previous);
    }
  };
  const saveEdit = async () => {
    if (!editName.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      await updatePlaylist(data.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      client.setQueryData<typeof data>(["playlist", id], {
        ...data,
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setEditing(false);
      void client.invalidateQueries({ queryKey: ["playlist", id] });
      void client.invalidateQueries({ queryKey: ["playlists"] });
    } finally {
      setSavingEdit(false);
    }
  };
  const duration = formatCollectionDuration(data.total_duration);
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View style={styles.nav}>
          <Pressable onPress={router.back}>
            <ArrowLeft color="white" />
          </Pressable>
          <Pressable onPress={() => setMenu(true)}>
            <MoreHorizontal color="white" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 130 }}>
          <View style={styles.hero}>
            <Artwork
              path={
                data.cover_image ?? data.cover_songs[0]?.album_object?.cover_url
              }
              size={240}
              rounded={10}
            />
            <Text style={styles.type}>PLAYLIST</Text>
            <Text style={styles.title}>{data.name}</Text>
            {data.description ? (
              <Text style={styles.description}>{data.description}</Text>
            ) : null}
            <Text style={styles.meta}>
              {data.song_count} songs, {duration}
            </Text>
            <Pressable
              style={styles.play}
              onPress={() =>
                data.songs[0] && player.playSong(data.songs[0], data.songs)
              }
            >
              <Play color="black" fill="black" size={28} />
            </Pressable>
          </View>
          {!data.songs.length ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>This playlist is empty</Text>
              <Text style={styles.emptyText}>
                Open any song’s actions and choose Add to playlist.
              </Text>
            </View>
          ) : null}
          {data.songs.map((song, index) => (
            <SongRow
              key={`${song.id}-${index}`}
              song={song}
              queue={data.songs}
              index={index}
              onRemove={() => void removeSong(song.id)}
            />
          ))}
        </ScrollView>
        <ActionDrawer
          open={menu}
          onClose={() => setMenu(false)}
          title={data.name}
        >
          <DrawerAction
            icon={Play}
            label="Play"
            onPress={() => {
              setMenu(false);
              if (data.songs[0]) player.playSong(data.songs[0], data.songs);
            }}
          />
          <DrawerAction
            icon={Pencil}
            label="Edit playlist"
            onPress={() => {
              setMenu(false);
              setEditName(data.name);
              setEditDescription(data.description ?? "");
              setEditing(true);
            }}
          />
          <DrawerAction
            icon={Trash2}
            label="Delete playlist"
            onPress={() => {
              setMenu(false);
              Alert.alert("Delete playlist?", data.name, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    void deletePlaylist(data.id).then(() => router.back()),
                },
              ]);
            }}
          />
        </ActionDrawer>
        <ActionDrawer
          open={editing}
          onClose={() => setEditing(false)}
          title="Edit playlist"
        >
          <View style={styles.editForm}>
            <TextInput
              placeholder="Name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              multiline
              placeholder="Description (optional)"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.descriptionInput]}
              value={editDescription}
              onChangeText={setEditDescription}
            />
            <Pressable
              disabled={savingEdit}
              style={styles.save}
              onPress={() => void saveEdit()}
            >
              <Text style={styles.saveText}>
                {savingEdit ? "Saving changes…" : "Save changes"}
              </Text>
            </Pressable>
          </View>
        </ActionDrawer>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: {
    height: 50,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hero: { padding: 20, alignItems: "flex-start" },
  type: {
    color: palette.secondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginTop: 22,
  },
  title: { color: "white", fontSize: 32, fontWeight: "900", marginTop: 5 },
  description: { color: palette.secondary, marginTop: 8, lineHeight: 20 },
  meta: { color: palette.secondary, marginTop: 8 },
  play: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  editForm: { padding: 10, gap: 10 },
  input: {
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: "#29292e",
    color: "white",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  descriptionInput: { minHeight: 90, textAlignVertical: "top" },
  save: {
    height: 50,
    borderRadius: 25,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "black", fontWeight: "800" },
  empty: {
    margin: 20,
    padding: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
  },
  emptyTitle: { color: "white", fontSize: 16, fontWeight: "800" },
  emptyText: {
    color: palette.secondary,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 7,
  },
});
