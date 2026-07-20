import { getHomeEssentials } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  RefreshControl,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AlbumRail,
  PageTitle,
  Screen,
  SectionTitle,
  SongRow,
} from "@/components/music-ui";
import { layout, palette } from "@/constants/colors";

export default function HomeScreen() {
  const home = useQuery({
    queryKey: ["home"],
    queryFn: getHomeEssentials,
  });
  const recommendedSongs = home.data
    ? home.data.recommended.length
      ? home.data.recommended
      : home.data.shuffle
    : [];
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          refreshControl={
            <RefreshControl
              tintColor="white"
              refreshing={home.isRefetching}
              onRefresh={() => void home.refetch()}
            />
          }
          contentContainerStyle={{
            paddingBottom: layout.tabBar + layout.miniPlayer + 34,
          }}
        >
          <PageTitle>Home</PageTitle>
          {home.isPending ? (
            <ActivityIndicator color="white" style={{ marginTop: 70 }} />
          ) : home.error ? (
            <Pressable
              accessibilityRole="button"
              style={styles.errorState}
              onPress={() => void home.refetch()}
            >
              <Text style={styles.error}>Could not load your music.</Text>
              <Text style={styles.retry}>Tap to try again</Text>
            </Pressable>
          ) : home.data ? (
            <>
              <SectionTitle>Recently played</SectionTitle>
              {home.data.continue_listening.slice(0, 8).map((song) => (
                <SongRow
                  key={song.id}
                  song={song}
                  queue={home.data.continue_listening}
                  showAlbum={false}
                />
              ))}
              <SectionTitle>Recommended songs</SectionTitle>
              {recommendedSongs.slice(0, 10).map((song) => (
                <SongRow key={song.id} song={song} queue={recommendedSongs} />
              ))}
              <SectionTitle>Albums you might like</SectionTitle>
              <AlbumRail albums={home.data.albums.slice(0, 6)} />
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: palette.secondary, textAlign: "center", marginTop: 80 },
  errorState: { alignItems: "center" },
  retry: { color: "white", fontWeight: "700", marginTop: 10 },
});
