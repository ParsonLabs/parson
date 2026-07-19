import { getHomeEssentials } from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  RefreshControl,
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
            <Text style={styles.error}>Could not load your music.</Text>
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
              {(home.data.recommended.length
                ? home.data.recommended
                : home.data.shuffle
              )
                .slice(0, 10)
                .map((song) => (
                  <SongRow
                    key={song.id}
                    song={song}
                    queue={home.data.recommended}
                  />
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
});
