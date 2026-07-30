import {
  getAlbumInfos,
  getArtistInfo,
  type Album,
  type LibraryAlbum,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Play, Shuffle } from "lucide-react-native";
import { useMemo, useState } from "react";
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
import { Screen, SectionTitle, SongRow } from "@/components/music-ui";
import { AlbumActions } from "@/components/album-actions";
import { palette } from "@/constants/colors";
import { usePlayer } from "@/providers/player-provider";
import {
  immediateBorderlessPressFeedback,
  immediatePressFeedback,
} from "@/lib/press-feedback";

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const player = usePlayer();
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
  const featuredAlbumIds = useMemo(
    () => artist.data?.featured_on_album_ids ?? [],
    [artist.data?.featured_on_album_ids],
  );
  const featured = useQuery({
    queryKey: ["artist-featured-albums", id, featuredAlbumIds],
    queryFn: () =>
      getAlbumInfos(featuredAlbumIds, false) as Promise<
        Record<string, LibraryAlbum>
      >,
    enabled: featuredAlbumIds.length > 0,
  });
  const songs = useMemo(() => {
    const seen = new Set<string>();
    return sections.flatMap((section) =>
      section.albums.flatMap((album) =>
        album.songs.filter((song) => {
          if (seen.has(song.id)) return false;
          seen.add(song.id);
          return true;
        }),
      ),
    );
  }, [sections]);
  const appearances = useMemo(() => {
    const data = artist.data;
    if (!data) return [];
    return featuredAlbumIds.flatMap((albumId) => {
      const album = featured.data?.[albumId];
      if (!album) return [];
      const track = album.songs.find(
        (song) =>
          song.contributing_artist_ids.includes(data.id) ||
          song.contributing_artists.some(
            (name) =>
              name.localeCompare(data.name, undefined, {
                sensitivity: "base",
              }) === 0,
          ),
      );
      return track ? [{ album, track }] : [];
    });
  }, [artist.data, featured.data, featuredAlbumIds]);
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
            {...immediateBorderlessPressFeedback}
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
            {data.icon_url ? (
              <Artwork
                path={data.icon_url}
                rounded={70}
                size={140}
                style={styles.portrait}
              />
            ) : null}
            <Text style={styles.title}>{data.name}</Text>
            {data.description ? (
              <Text numberOfLines={4} style={styles.description}>
                {data.description}
              </Text>
            ) : null}
            {songs.length ? (
              <View style={styles.actions}>
                <Pressable
                  {...immediateBorderlessPressFeedback}
                  accessibilityLabel={`Shuffle ${data.name}`}
                  accessibilityRole="button"
                  style={styles.shuffle}
                  onPress={() => player.playShuffled(songs)}
                >
                  <Shuffle color="white" size={22} />
                </Pressable>
                <Pressable
                  {...immediatePressFeedback}
                  accessibilityLabel={`Play ${data.name}`}
                  accessibilityRole="button"
                  style={styles.play}
                  onPress={() => songs[0] && player.playSong(songs[0], songs)}
                >
                  <Play color="black" fill="black" size={27} />
                </Pressable>
              </View>
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
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          {appearances.length ? (
            <View>
              <SectionTitle>Appears on</SectionTitle>
              {appearances.map(({ album, track }) => (
                <SongRow
                  key={`${album.id}-${track.id}`}
                  queue={appearances.map((appearance) => appearance.track)}
                  showAlbum
                  song={track}
                />
              ))}
            </View>
          ) : null}
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
  portrait: { marginBottom: 20 },
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
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 20,
  },
  shuffle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.elevatedStrong,
  },
  play: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
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
  errorState: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: palette.secondary },
});
