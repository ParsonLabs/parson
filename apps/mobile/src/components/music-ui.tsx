import type { LibrarySong, ResponseAlbum } from "@parson/music-sdk";
import { useRouter } from "expo-router";
import {
  Disc3,
  Download,
  ListEnd,
  ListPlus,
  MoreHorizontal,
  Play,
  X,
  UserRound,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Artwork } from "@/components/artwork";
import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { palette } from "@/constants/colors";
import { usePlayer } from "@/providers/player-provider";
import {
  downloadSong,
  isSongDownloaded,
  removeDownload,
  useDownloadsRevision,
} from "@/lib/downloads";
import { AlbumActions } from "@/components/album-actions";
import { PlaylistPicker } from "@/components/playlist-picker";
import { useSession } from "@/providers/session-provider";

export function Screen({ children }: { children?: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function PageTitle({
  children,
  subtitle,
}: {
  children: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <View style={styles.titleBlock}>
      <Text accessibilityRole="header" style={styles.pageTitle}>
        {children}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function SongRow({
  song,
  queue,
  index,
  onRemove,
  showAlbum = true,
}: {
  song: LibrarySong;
  queue?: LibrarySong[];
  index?: number;
  onRemove?: () => void;
  showAlbum?: boolean;
}) {
  const player = usePlayer();
  const session = useSession();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [playlistPicker, setPlaylistPicker] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useDownloadsRevision();
  const active = player.current?.id === song.id;
  return (
    <View style={styles.songRow}>
      <Pressable
        accessibilityLabel={`${song.name} by ${song.artist}`}
        accessibilityRole="button"
        style={({ pressed }) => [styles.songMain, pressed && styles.pressed]}
        onPress={() => {
          if (menu) return;
          if (active) player.toggle();
          else player.playSong(song, queue);
        }}
        onLongPress={() => setMenu(true)}
        delayLongPress={220}
      >
        {index !== undefined ? (
          <Text style={styles.trackNumber}>{index + 1}</Text>
        ) : (
          <Artwork path={song.album_object?.cover_url} size={48} />
        )}
        <View style={styles.songLabels}>
          <Text numberOfLines={1} style={styles.songTitle}>
            {song.name}
          </Text>
          <Text numberOfLines={1} style={styles.songArtist}>
            {song.artist}
            {showAlbum && song.album_object?.name
              ? ` • ${song.album_object.name}`
              : ""}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`More actions for ${song.name}`}
        accessibilityRole="button"
        hitSlop={12}
        onPress={() => setMenu(true)}
        style={styles.rowMenuButton}
      >
        <MoreHorizontal color={palette.secondary} size={20} />
      </Pressable>
      <ActionDrawer
        open={menu}
        onClose={() => setMenu(false)}
        title={`${song.name} • ${song.artist}`}
      >
        <DrawerAction
          icon={Play}
          label="Play"
          onPress={() => {
            setMenu(false);
            player.playSong(song, queue);
          }}
        />
        <DrawerAction
          icon={ListPlus}
          label="Play next"
          onPress={() => {
            setMenu(false);
            player.addNext(song);
          }}
        />
        <DrawerAction
          icon={ListEnd}
          label="Add to queue"
          onPress={() => {
            setMenu(false);
            player.addToQueue([song]);
          }}
        />
        {session.phase !== "offline" && song.album_object?.id ? (
          <DrawerAction
            icon={Disc3}
            label="View album"
            onPress={() => {
              setMenu(false);
              router.push(`/album/${song.album_object.id}`);
            }}
          />
        ) : null}
        {session.phase !== "offline" && song.artist_object?.id ? (
          <DrawerAction
            icon={UserRound}
            label="View artist"
            onPress={() => {
              setMenu(false);
              router.push(`/artist/${song.artist_object.id}`);
            }}
          />
        ) : null}
        {session.phase !== "offline" ? (
          <DrawerAction
            icon={ListPlus}
            label="Add to playlist"
            onPress={() => {
              setMenu(false);
              setPlaylistPicker(true);
            }}
          />
        ) : null}
        {session.phase !== "offline" || isSongDownloaded(song.id) ? (
          <DrawerAction
            icon={isSongDownloaded(song.id) ? X : Download}
            label={
              isSongDownloaded(song.id)
                ? "Delete from device"
                : downloading
                  ? "Downloading song…"
                  : downloadError
                    ? "Download failed · Try again"
                    : "Download song"
            }
            onPress={() => {
              if (downloading) return;
              if (isSongDownloaded(song.id)) {
                void removeDownload(song.id)
                  .then(() => setMenu(false))
                  .catch(() => setDownloadError(true));
                return;
              }
              setDownloadError(false);
              setDownloading(true);
              void downloadSong(song)
                .then(() => setMenu(false))
                .catch(() => setDownloadError(true))
                .finally(() => setDownloading(false));
            }}
          />
        ) : null}
        {downloadError ? (
          <Text accessibilityRole="alert" style={styles.actionError}>
            The download action failed. Please try again.
          </Text>
        ) : null}
        {onRemove ? (
          <DrawerAction
            icon={X}
            label="Remove from playlist"
            onPress={() => {
              setMenu(false);
              onRemove();
            }}
          />
        ) : null}
      </ActionDrawer>
      <PlaylistPicker
        open={session.phase !== "offline" && playlistPicker}
        onClose={() => setPlaylistPicker(false)}
        songId={song.id}
      />
    </View>
  );
}

export function AlbumRail({ albums }: { albums: ResponseAlbum[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ResponseAlbum | null>(null);
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {albums.map((album) => (
          <Pressable
            accessibilityLabel={`${album.name} by ${
              album.artist_object?.name ??
              album.contributing_artists?.[0] ??
              "Unknown artist"
            }`}
            accessibilityRole="button"
            key={album.id}
            style={styles.card}
            onPress={() => {
              if (!selected) router.push(`/album/${album.id}`);
            }}
            onLongPress={() => setSelected(album)}
          >
            <Artwork path={album.cover_url} size={154} rounded={10} />
            <Text numberOfLines={1} style={styles.cardTitle}>
              {album.name}
            </Text>
            <Text numberOfLines={1} style={styles.cardSubtitle}>
              {album.artist_object?.name ??
                album.contributing_artists?.[0] ??
                "Album"}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {selected ? (
        <AlbumActions
          open
          albumId={selected.id}
          artistId={selected.artist_object?.id}
          name={selected.name}
          loaded={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  titleBlock: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 },
  pageTitle: {
    color: "white",
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "900",
    letterSpacing: -1,
  },
  subtitle: { color: palette.secondary, marginTop: 4, fontSize: 14 },
  sectionTitle: {
    color: "white",
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 13,
  },
  songRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 8,
  },
  songMain: {
    minHeight: 64,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pressed: { opacity: 0.62 },
  actionError: { color: "#ff9b9b", paddingHorizontal: 16, paddingVertical: 8 },
  trackNumber: {
    color: palette.secondary,
    width: 24,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  songLabels: { flex: 1, justifyContent: "center" },
  songTitle: { color: "white", fontSize: 15, fontWeight: "600" },
  songArtist: { color: palette.secondary, fontSize: 13, marginTop: 3 },
  rowMenuButton: {
    width: 36,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  rail: { paddingHorizontal: 20, gap: 15 },
  card: { width: 154 },
  cardTitle: { color: "white", fontWeight: "700", fontSize: 14, marginTop: 9 },
  cardSubtitle: { color: palette.secondary, fontSize: 13, marginTop: 3 },
});
