import { getArtistInfo } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
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
import { Screen, SectionTitle } from "@/components/music-ui";
import { AlbumActions } from "@/components/album-actions";
import { useMemo, useState } from "react";
import type { Album } from "@parson/music-sdk";
import { palette } from "@/constants/colors";

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState<Album | null>(null);
  const artist = useQuery({
    queryKey: ["artist", id],
    queryFn: () => getArtistInfo(id),
    enabled: !!id,
  });
  const sections = useMemo(() => {
    const data = artist.data;
    if (!data) return [];
    const sort = (albums: Album[]) =>
      [...albums].sort((a, b) => {
        const left = Date.parse(a.first_release_date || "");
        const right = Date.parse(b.first_release_date || "");
        return (
          (Number.isFinite(right) ? right : -Infinity) -
          (Number.isFinite(left) ? left : -Infinity)
        );
      });
    return data.discography?.length
      ? data.discography.map((section) => ({
          ...section,
          albums: sort(section.albums),
        }))
      : [{ key: "albums", title: "Albums", albums: sort(data.albums) }];
  }, [artist.data]);
  if (artist.isPending)
    return (
      <Screen>
        <ActivityIndicator color="white" style={{ flex: 1 }} />
      </Screen>
    );
  if (!artist.data)
    return (
      <Screen>
        <Pressable
          accessibilityRole="button"
          style={styles.errorState}
          onPress={() => void artist.refetch()}
        >
          <Text style={styles.error}>Could not load artist · Tap to retry</Text>
        </Pressable>
      </Screen>
    );
  const data = artist.data;
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
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 135 }}>
          <View style={styles.hero}>
            <Text style={styles.title}>{data.name}</Text>
            {data.description ? (
              <Text numberOfLines={4} style={styles.description}>
                {data.description}
              </Text>
            ) : null}
          </View>
          {sections.map((section) => (
            <View key={section.key}>
              <SectionTitle>{section.title}</SectionTitle>
              <View style={styles.grid}>
                {section.albums.map((album) => (
                  <Pressable
                    accessibilityLabel={`${album.name}, ${album.primary_type || "Album"}`}
                    accessibilityRole="button"
                    key={album.id}
                    style={styles.card}
                    onPress={() => {
                      if (!selected) router.push(`/album/${album.id}`);
                    }}
                    onLongPress={() => setSelected(album)}
                  >
                    <Artwork path={album.cover_url} size={156} rounded={9} />
                    <Text numberOfLines={2} style={styles.albumName}>
                      {album.name}
                    </Text>
                    <Text style={styles.year}>
                      {album.primary_type || "Album"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
        {selected ? (
          <AlbumActions
            open
            albumId={selected.id}
            artistId={data.id}
            name={selected.name}
            showArtist={false}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { height: 48, paddingHorizontal: 20, justifyContent: "center" },
  hero: { alignItems: "center", paddingHorizontal: 20, paddingBottom: 28 },
  title: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: -1,
    textAlign: "center",
  },
  description: {
    color: palette.secondary,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    gap: 16,
  },
  card: { width: 156 },
  albumName: {
    color: "white",
    fontWeight: "700",
    marginTop: 8,
    lineHeight: 18,
  },
  year: { color: palette.secondary, fontSize: 12, marginTop: 3 },
  errorState: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: palette.secondary },
});
