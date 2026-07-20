import { getAlbumInfo, type LibraryAlbum } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, MoreHorizontal, Play } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Artwork } from "@/components/artwork";
import { AlbumActions } from "@/components/album-actions";
import { PauseGlyph } from "@/components/pause-glyph";
import { Screen, SongRow } from "@/components/music-ui";
import { palette } from "@/constants/colors";
import { usePlayer } from "@/providers/player-provider";
import { formatCollectionDuration } from "@/lib/format";

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const player = usePlayer();
  const album = useQuery({
    queryKey: ["album", id],
    queryFn: () => getAlbumInfo(id, false) as Promise<LibraryAlbum>,
    enabled: !!id,
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  if (album.isPending)
    return (
      <Screen>
        <ActivityIndicator color="white" style={{ flex: 1 }} />
      </Screen>
    );
  if (!album.data)
    return (
      <Screen>
        <Pressable
          accessibilityRole="button"
          style={styles.errorState}
          onPress={() => void album.refetch()}
        >
          <Text style={styles.error}>Could not load album · Tap to retry</Text>
        </Pressable>
      </Screen>
    );
  const data = album.data;
  const artist =
    data.artist_object?.name ??
    data.contributing_artists?.[0] ??
    "Unknown artist";
  const totalDuration = formatCollectionDuration(
    data.songs.reduce((sum, song) => sum + (song.duration || 0), 0),
  );
  const albumPlaying =
    player.isPlaying && player.current?.album_object?.id === data.id;
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <View style={styles.nav}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={12}
            onPress={router.back}
          >
            <ArrowLeft color="white" size={25} />
          </Pressable>
          <Pressable
            accessibilityLabel="More album actions"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => setActionsOpen(true)}
          >
            <MoreHorizontal color="white" size={25} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 135 }}>
          <View style={styles.hero}>
            <Artwork
              path={data.cover_url}
              size={260}
              rounded={12}
              style={styles.cover}
            />
            <Text style={styles.title}>{data.name}</Text>
            <Pressable
              accessibilityLabel={`View ${artist}`}
              accessibilityRole="button"
              disabled={!data.artist_object?.id}
              style={styles.artistRow}
              onPress={() =>
                data.artist_object?.id &&
                router.push(`/artist/${data.artist_object.id}`)
              }
            >
              <Text style={styles.artist}>{artist}</Text>
            </Pressable>
            <Text style={styles.meta}>
              {data.songs.length} songs, {totalDuration}
            </Text>
            <View style={styles.actions}>
              <Pressable
                accessibilityLabel={albumPlaying ? "Pause album" : "Play album"}
                accessibilityRole="button"
                disabled={!data.songs.length}
                style={styles.circle}
                onPress={() =>
                  albumPlaying
                    ? player.toggle()
                    : data.songs[0] &&
                      player.playSong(data.songs[0], data.songs)
                }
              >
                {albumPlaying ? (
                  <PauseGlyph color="black" size={25} />
                ) : (
                  <Play color="black" fill="black" size={28} />
                )}
              </Pressable>
            </View>
          </View>
          {data.songs.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              queue={data.songs}
              index={index}
              showAlbum={false}
            />
          ))}
          {data.description ? (
            <Text style={styles.description}>{data.description}</Text>
          ) : null}
        </ScrollView>
        <AlbumActions
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          albumId={data.id}
          artistId={data.artist_object?.id}
          name={data.name}
          loaded={data}
          showAlbum={false}
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: {
    height: 50,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  hero: { paddingHorizontal: 20, alignItems: "flex-start" },
  cover: {
    alignSelf: "center",
    marginVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 12,
  },
  title: {
    color: "white",
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginTop: 14,
  },
  artistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 9,
  },
  artist: { color: "white", fontWeight: "800", fontSize: 15 },
  meta: { color: palette.secondary, fontSize: 13, marginTop: 5 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 17,
    marginVertical: 22,
  },
  circle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  description: {
    color: palette.secondary,
    fontSize: 14,
    lineHeight: 21,
    margin: 20,
  },
  error: { color: palette.secondary, margin: 30 },
  errorState: { flex: 1, alignItems: "center", justifyContent: "center" },
});
