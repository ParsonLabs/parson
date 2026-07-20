import {
  getAlbumInfo,
  searchLibrary,
  type CombinedItem,
  type LibraryAlbum,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Play, Search as SearchIcon, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Artwork } from "@/components/artwork";
import { PageTitle, Screen, SongRow } from "@/components/music-ui";
import { AlbumActions } from "@/components/album-actions";
import { ArtistActions } from "@/components/artist-actions";
import { layout, palette } from "@/constants/colors";
import { usePlayer } from "@/providers/player-provider";
import { playableSearchSong } from "@/lib/playable-song";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [deferred, setDeferred] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDeferred(query.trim()), 250);
    return () => clearTimeout(timeout);
  }, [query]);
  const results = useQuery({
    queryKey: ["search", deferred],
    queryFn: () => searchLibrary(deferred),
    enabled: deferred.length > 0,
    staleTime: 60_000,
  });
  const uniqueResults = useMemo(
    () =>
      Array.from(
        new Map(
          (results.data ?? []).map(
            (item) => [`${item.item_type}-${item.id}`, item] as const,
          ),
        ).values(),
      ),
    [results.data],
  );
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <PageTitle>Search</PageTitle>
        <View style={styles.searchBox}>
          <SearchIcon color={palette.secondary} size={21} />
          <TextInput
            accessibilityLabel="Search songs, artists and albums"
            autoFocus={false}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Songs, artists and albums"
            placeholderTextColor={palette.secondary}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
          />
          {query ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              onPress={() => setQuery("")}
            >
              <X color="white" size={20} />
            </Pressable>
          ) : null}
        </View>
        {results.isFetching ? (
          <ActivityIndicator color="white" style={{ marginTop: 30 }} />
        ) : results.isError ? (
          <Pressable
            accessibilityRole="button"
            style={styles.retry}
            onPress={() => void results.refetch()}
          >
            <Text style={styles.empty}>Search failed · Tap to try again</Text>
          </Pressable>
        ) : deferred && results.data?.length === 0 ? (
          <Text style={styles.empty}>No results for “{deferred}”</Text>
        ) : null}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingBottom: layout.tabBar + layout.miniPlayer + 24,
          }}
        >
          {uniqueResults.map((item, index) => (
            <SearchResult
              key={`${item.item_type}-${item.id}-${index}`}
              item={item}
            />
          ))}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function SearchResult({ item }: { item: CombinedItem }) {
  const router = useRouter();
  const player = usePlayer();
  const type = item.item_type.toLowerCase();
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playFailed, setPlayFailed] = useState(false);
  const path = item.album_object?.cover_url;
  const open = () => {
    if (menu) return;
    if (type.includes("album")) router.push(`/album/${item.id}`);
    else if (type.includes("artist")) router.push(`/artist/${item.id}`);
    else if (type.includes("song")) {
      player.playSong(playableSearchSong(item));
    }
  };
  const playAlbum = async () => {
    if (playing) return;
    setPlayFailed(false);
    setPlaying(true);
    try {
      const album = (await getAlbumInfo(item.id, false)) as LibraryAlbum;
      if (album.songs[0]) player.playSong(album.songs[0], album.songs);
    } catch {
      setPlayFailed(true);
    } finally {
      setPlaying(false);
    }
  };
  if (type.includes("song")) return <SongRow song={playableSearchSong(item)} />;
  return (
    <>
      <View style={styles.result}>
        <Pressable
          accessibilityLabel={`${item.name}, ${item.item_type}`}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.resultMain,
            pressed && { opacity: 0.6 },
          ]}
          onPress={open}
          onLongPress={() => setMenu(true)}
        >
          {!type.includes("artist") ? (
            <Artwork path={path} size={52} rounded={7} />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.resultName}>
              {item.name}
            </Text>
            <Text style={styles.resultType}>
              {item.item_type}
              {item.artist_object?.name ? ` • ${item.artist_object.name}` : ""}
            </Text>
          </View>
        </Pressable>
        {type.includes("album") ? (
          playing ? (
            <ActivityIndicator color="white" />
          ) : (
            <Pressable
              accessibilityLabel={`${playFailed ? "Try playing" : "Play"} ${item.name}`}
              accessibilityRole="button"
              hitSlop={12}
              onPress={(event) => {
                event.stopPropagation();
                void playAlbum();
              }}
            >
              <Play
                color={palette.secondary}
                fill={palette.secondary}
                size={18}
              />
            </Pressable>
          )
        ) : null}
      </View>
      {type.includes("album") ? (
        <AlbumActions
          open={menu}
          onClose={() => setMenu(false)}
          albumId={item.id}
          artistId={item.artist_object?.id}
          name={item.name}
        />
      ) : type.includes("artist") ? (
        <ArtistActions
          open={menu}
          onClose={() => setMenu(false)}
          artistId={item.id}
          name={item.name}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    marginHorizontal: 20,
    height: 50,
    borderRadius: 13,
    backgroundColor: palette.elevatedStrong,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
    marginBottom: 12,
  },
  input: { flex: 1, color: "white", fontSize: 16, paddingVertical: 0 },
  empty: { color: palette.secondary, textAlign: "center", marginTop: 48 },
  retry: { minHeight: 80, alignItems: "center", justifyContent: "center" },
  result: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 20,
    paddingRight: 20,
  },
  resultMain: {
    minHeight: 68,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  resultName: { color: "white", fontWeight: "700", fontSize: 15 },
  resultType: {
    color: palette.secondary,
    fontSize: 13,
    marginTop: 4,
    textTransform: "capitalize",
  },
});
