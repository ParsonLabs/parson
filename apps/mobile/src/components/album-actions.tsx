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
  const [downloadProgress, setDownloadProgress] = useState({
    done: 0,
    total: 0,
  });
  const [editName, setEditName] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [operationError, setOperationError] = useState("");
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
  const openEditor = async () => {
    setOperationError("");
    setEditing(true);
    setEditorLoading(true);
    try {
      const album = await load();
      setEditName(album.name);
      setEditArtist(album.artist_object.name);
      setEditDate(album.first_release_date ?? "");
      setEditType(album.primary_type ?? "");
      setEditDescription(album.description ?? "");
    } catch {
      setEditing(false);
      setOperationError("Could not load the album editor.");
    } finally {
      setEditorLoading(false);
    }
  };
  const saveEditor = async () => {
    if (!editName.trim() || !editArtist.trim() || editorSaving) return;
    setOperationError("");
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
    } catch {
      setOperationError("Could not save the album metadata.");
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
          onPress={() => {
            setOperationError("");
            void load()
              .then((album) => {
                if (album.songs[0])
                  player.playSong(album.songs[0], album.songs);
                onClose();
              })
              .catch(() => setOperationError("Could not load this album."));
          }}
        />
        <DrawerAction
          icon={ListEnd}
          label="Add to queue"
          onPress={() => {
            setOperationError("");
            void load()
              .then((album) => {
                player.addToQueue(album.songs);
                onClose();
              })
              .catch(() => setOperationError("Could not load this album."));
          }}
        />
        {session.phase !== "offline" && showAlbum ? (
          <DrawerAction
            icon={Disc3}
            label="View album"
            onPress={() => {
              onClose();
              router.push(`/album/${albumId}`);
            }}
          />
        ) : null}
        {session.phase !== "offline" || albumDownloaded ? (
          <DrawerAction
            icon={albumDownloaded ? X : Download}
            label={
              albumDownloaded
                ? "Delete album from device"
                : downloading
                  ? `Downloading album${downloadProgress.total ? ` · ${downloadProgress.done}/${downloadProgress.total}` : "…"}`
                  : "Download album"
            }
            onPress={() => {
              if (downloading) return;
              if (albumDownloaded && album) {
                setOperationError("");
                void removeDownloads(album.songs.map((song) => song.id))
                  .then(onClose)
                  .catch(() =>
                    setOperationError("Could not delete the album download."),
                  );
                return;
              }
              setOperationError("");
              setDownloading(true);
              setDownloadProgress({ done: 0, total: 0 });
              void (async () => {
                const album = await load();
                setDownloadProgress({ done: 0, total: album.songs.length });
                await downloadAlbum(album.name, album.songs, (done) =>
                  setDownloadProgress({ done, total: album.songs.length }),
                );
                setDownloading(false);
                onClose();
              })().catch(() => {
                setDownloading(false);
                setOperationError("Could not download this album.");
              });
            }}
          />
        ) : null}
        {session.phase !== "offline" ? (
          <DrawerAction
            icon={ListPlus}
            label="Add to playlist"
            onPress={() => setPickingPlaylist(true)}
          />
        ) : null}
        {session.phase !== "offline" && artistId && showArtist ? (
          <DrawerAction
            icon={UserRound}
            label="View artist"
            onPress={() => {
              onClose();
              router.push(`/artist/${artistId}`);
            }}
          />
        ) : null}
        {operationError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {operationError}
          </Text>
        ) : null}
        {session.phase !== "offline" && session.claims?.role === "admin" ? (
          <DrawerAction
            icon={Pencil}
            label="Edit album metadata"
            onPress={() => void openEditor()}
          />
        ) : null}
      </ActionDrawer>
      <PlaylistPicker
        open={session.phase !== "offline" && open && pickingPlaylist}
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
              accessibilityLabel="Album name"
              placeholder="Album name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              accessibilityLabel="Artist name"
              placeholder="Artist name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={editArtist}
              onChangeText={setEditArtist}
            />
            <View style={styles.row}>
              <TextInput
                accessibilityLabel="Release date"
                placeholder="Release date"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.flex]}
                value={editDate}
                onChangeText={setEditDate}
              />
              <TextInput
                accessibilityLabel="Release type"
                placeholder="Type"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.flex]}
                value={editType}
                onChangeText={setEditType}
              />
            </View>
            <TextInput
              accessibilityLabel="Description"
              multiline
              placeholder="Description"
              placeholderTextColor={palette.muted}
              style={[styles.input, styles.description]}
              value={editDescription}
              onChangeText={setEditDescription}
            />
            <Pressable
              accessibilityRole="button"
              disabled={editorSaving || !editName.trim() || !editArtist.trim()}
              style={[
                styles.save,
                (editorSaving || !editName.trim() || !editArtist.trim()) &&
                  styles.disabled,
              ]}
              onPress={() => void saveEditor()}
            >
              <Text style={styles.saveText}>
                {editorSaving ? "Saving changes…" : "Save changes"}
              </Text>
            </Pressable>
            {operationError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {operationError}
              </Text>
            ) : null}
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
  disabled: { opacity: 0.45 },
  error: { color: "#ff9b9b", paddingHorizontal: 16, paddingVertical: 8 },
});
