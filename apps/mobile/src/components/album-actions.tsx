import {
  editAlbumMetadata,
  getAlbumInfo,
  type LibraryAlbum,
} from "@parson/music-sdk";
import { useQueryClient } from "@tanstack/react-query";
import {
  Disc3,
  Download,
  ListEnd,
  ListPlus,
  Play,
  Pencil,
  UserRound,
  X,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import {
  downloadAlbum,
  isSongDownloaded,
  removeDownloads,
  useDownloadsRevision,
} from "@/lib/downloads";
import { usePlayer } from "@/providers/player-provider";
import { PlaylistPicker } from "@/components/playlist-picker";
import { useSession } from "@/providers/session-provider";
import { palette } from "@/constants/colors";

export function AlbumActions({
  albumId,
  artistId,
  name,
  onClose,
  open,
  loaded,
  showAlbum = true,
  showArtist = true,
}: {
  albumId: string;
  artistId?: string;
  name?: string;
  onClose: () => void;
  open: boolean;
  loaded?: LibraryAlbum;
  showAlbum?: boolean;
  showArtist?: boolean;
}) {
  const router = useRouter();
  const player = usePlayer();
  const session = useSession();
  const client = useQueryClient();
  const [pickingPlaylist, setPickingPlaylist] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editName, setEditName] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [resolvedAlbum, setResolvedAlbum] = useState<LibraryAlbum | null>(null);
  useDownloadsRevision();
  useEffect(() => {
    if (loaded || !open) return;
    void (getAlbumInfo(albumId, false) as Promise<LibraryAlbum>)
      .then(setResolvedAlbum)
      .catch(() => {});
  }, [albumId, loaded, open]);
  const album = loaded ?? resolvedAlbum;
  const albumDownloaded =
    !!album?.songs.length &&
    album.songs.every((song) => isSongDownloaded(song.id));
  const load = () =>
    loaded
      ? Promise.resolve(loaded)
      : album
        ? Promise.resolve(album)
        : (getAlbumInfo(albumId, false) as Promise<LibraryAlbum>).then(
            (album) => {
              setResolvedAlbum(album);
              return album;
            },
          );
  const closeThen = (run: () => void | Promise<void>) => {
    onClose();
    void run();
  };
  const openEditor = async () => {
    setEditing(true);
    setEditorLoading(true);
    try {
      const album = await load();
      setEditName(album.name);
      setEditArtist(album.artist_object.name);
      setEditDate(album.first_release_date ?? "");
      setEditType(album.primary_type ?? "");
      setEditDescription(album.description ?? "");
    } finally {
      setEditorLoading(false);
    }
  };
  const saveEditor = async () => {
    if (!editName.trim() || !editArtist.trim() || editorSaving) return;
    setEditorSaving(true);
    try {
      await editAlbumMetadata(albumId, {
        album: {
          name: editName.trim(),
          first_release_date: editDate.trim(),
          primary_type: editType.trim(),
          description: editDescription.trim(),
        },
        artist: { name: editArtist.trim() },
      });
      setEditing(false);
      onClose();
      void Promise.all([
        client.invalidateQueries({ queryKey: ["album", albumId] }),
        client.invalidateQueries({ queryKey: ["home"] }),
        client.invalidateQueries({ queryKey: ["library"] }),
      ]);
    } finally {
      setEditorSaving(false);
    }
  };
  return (
    <>
      <ActionDrawer
        open={open && !pickingPlaylist && !editing}
        onClose={onClose}
        title={name}
      >
        <DrawerAction
          icon={Play}
          label="Play"
          onPress={() =>
            closeThen(async () => {
              const album = await load();
              if (album.songs[0]) player.playSong(album.songs[0], album.songs);
            })
          }
        />
        <DrawerAction
          icon={ListEnd}
          label="Add to queue"
          onPress={() =>
            closeThen(async () => {
              const album = await load();
              player.addToQueue(album.songs);
            })
          }
        />
        {showAlbum ? (
          <DrawerAction
            icon={Disc3}
            label="View album"
            onPress={() => closeThen(() => router.push(`/album/${albumId}`))}
          />
        ) : null}
        <DrawerAction
          icon={albumDownloaded ? X : Download}
          label={
            albumDownloaded
              ? "Delete album from device"
              : downloading
                ? "Downloading album…"
                : "Download album"
          }
          onPress={() => {
            if (downloading) return;
            if (albumDownloaded && album) {
              onClose();
              void removeDownloads(album.songs.map((song) => song.id));
              return;
            }
            setDownloading(true);
            void (async () => {
              const album = await load();
              await downloadAlbum(album.name, album.songs);
              setDownloading(false);
              onClose();
            })().catch(() => setDownloading(false));
          }}
        />
        <DrawerAction
          icon={ListPlus}
          label="Add to playlist"
          onPress={() => setPickingPlaylist(true)}
        />
        {artistId && showArtist ? (
          <DrawerAction
            icon={UserRound}
            label="View artist"
            onPress={() => closeThen(() => router.push(`/artist/${artistId}`))}
          />
        ) : null}
        {session.claims?.role === "admin" ? (
          <DrawerAction
            icon={Pencil}
            label="Edit album metadata"
            onPress={() => void openEditor()}
          />
        ) : null}
      </ActionDrawer>
      <PlaylistPicker
        open={open && pickingPlaylist}
        albumId={albumId}
        onClose={() => {
          setPickingPlaylist(false);
          onClose();
        }}
      />
      <ActionDrawer
        open={open && editing}
        onClose={() => {
          setEditing(false);
          onClose();
        }}
        title="Edit album"
      >
        {editorLoading ? (
          <View style={styles.editorLoading}>
            <ActivityIndicator color="white" />
            <Text style={styles.editorLoadingText}>Loading album…</Text>
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              placeholder="Album name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              placeholder="Artist name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={editArtist}
              onChangeText={setEditArtist}
            />
            <View style={styles.row}>
              <TextInput
                placeholder="Release date"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.flex]}
                value={editDate}
                onChangeText={setEditDate}
              />
              <TextInput
                placeholder="Type"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.flex]}
                value={editType}
                onChangeText={setEditType}
              />
            </View>
            <TextInput
              multiline
              placeholder="Description"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.description]}
              value={editDescription}
              onChangeText={setEditDescription}
            />
            <Pressable
              disabled={editorSaving}
              style={styles.save}
              onPress={() => void saveEditor()}
            >
              <Text style={styles.saveText}>
                {editorSaving ? "Saving changes…" : "Save changes"}
              </Text>
            </Pressable>
          </View>
        )}
      </ActionDrawer>
    </>
  );
}

const styles = StyleSheet.create({
  editorLoading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  editorLoadingText: { color: palette.secondary },
  form: { padding: 10, gap: 9 },
  row: { flexDirection: "row", gap: 9 },
  flex: { flex: 1 },
  input: {
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: "#29292e",
    color: "white",
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  description: { minHeight: 88, textAlignVertical: "top" },
  save: {
    height: 50,
    borderRadius: 25,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "black", fontWeight: "800" },
});
