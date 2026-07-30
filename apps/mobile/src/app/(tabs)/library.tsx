import {
  getLibraryCatalog,
  getLibraryCatalogArtists,
  getFavoriteSongDetails,
  getPlaylists,
  getSongInfos,
  type LibrarySong,
  type LibraryAlbum,
  type LibraryCatalogAlbum,
  type LibraryCatalogArtist,
  type PlaylistSummary,
} from "@parson/music-sdk";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Heart, Shuffle } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Artwork } from "@/components/artwork";
import { PageTitle, Screen, SongRow } from "@/components/music-ui";
import { layout, palette } from "@/constants/colors";
import { playableCatalogSong } from "@/lib/playable-song";
import { AlbumActions } from "@/components/album-actions";
import { ArtistActions } from "@/components/artist-actions";
import { PlaylistActions } from "@/components/playlist-actions";
import { PlaylistPicker } from "@/components/playlist-picker";
import {
  downloadedRecords,
  enrichDownloadedSongs,
  groupDownloadedLibrary,
  hydrateDownloads,
  useDownloadsRevision,
} from "@/lib/downloads";
import { useSession } from "@/providers/session-provider";
import { usePlayer } from "@/providers/player-provider";
import { PlaylistCover } from "@/components/playlist-cover";

const PAGE_SIZE = 100;

type Section =
  "albums" | "songs" | "downloads" | "liked" | "artists" | "playlists";

export default function LibraryScreen() {
  const session = useSession();
  const player = usePlayer();
  const client = useQueryClient();
  const [selectedSection, setSection] = useState<Section>(() =>
    session.phase === "offline" ? "downloads" : "albums",
  );
  const section = session.phase === "offline" ? "downloads" : selectedSection;
  const [selectedAlbum, setSelectedAlbum] =
    useState<LibraryCatalogAlbum | null>(null);
  const [selectedArtist, setSelectedArtist] =
    useState<LibraryCatalogArtist | null>(null);
  const [selectedDownloadedAlbum, setSelectedDownloadedAlbum] =
    useState<LibraryAlbum | null>(null);
  const [selectedPlaylist, setSelectedPlaylist] =
    useState<PlaylistSummary | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const downloadsRevision = useDownloadsRevision();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const playlistCardSize = Math.floor((windowWidth - 56) / 2);

  const catalog = useInfiniteQuery({
    queryKey: ["library", "catalog", section],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getLibraryCatalog(pageParam, PAGE_SIZE, section as "albums" | "songs"),
    getNextPageParam: (lastPage, pages) => {
      const next = pages.length * PAGE_SIZE;
      const total =
        section === "albums" ? lastPage.totalAlbums : lastPage.totalSongs;
      return next < total ? next : undefined;
    },
    enabled: section === "albums" || section === "songs",
  });
  const artists = useInfiniteQuery({
    queryKey: ["library", "catalog", "artists"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getLibraryCatalogArtists(pageParam, PAGE_SIZE),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: section === "artists",
  });
  const liked = useInfiniteQuery({
    queryKey: ["favorite-song-details"],
    initialPageParam: undefined as
      { before_added_at: string; before_song_id: string } | undefined,
    queryFn: ({ pageParam }) =>
      getFavoriteSongDetails({ limit: PAGE_SIZE, ...pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      const last = lastPage.at(-1);
      return last
        ? { before_added_at: last.added_at, before_song_id: last.song_id }
        : undefined;
    },
    enabled: section === "liked",
  });
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: getPlaylists,
    enabled: section === "playlists",
  });
  const downloads = useQuery({
    queryKey: ["downloads", downloadsRevision],
    queryFn: async () => {
      await hydrateDownloads();
      let records = downloadedRecords();
      const missing = records
        .filter((record) => !record.song)
        .map((record) => record.id);
      if (missing.length) {
        try {
          const resolved = await getSongInfos(missing, false);
          await enrichDownloadedSongs(Object.values(resolved) as LibrarySong[]);
          records = downloadedRecords();
        } catch {
          // Keep downloaded metadata available offline.
        }
      }
      return records.flatMap((record) => (record.song ? [record.song] : []));
    },
    enabled: section === "downloads",
  });
  const catalogPages = catalog.data?.pages ?? [];
  const albumItems = catalogPages.flatMap((page) => page.albums);
  const songItems = catalogPages.flatMap((page) => page.songs);
  const playableSongs = songItems.map(playableCatalogSong);
  const artistItems = artists.data?.pages.flat() ?? [];
  const likedSongs =
    liked.data?.pages.flatMap((page) => page.map((item) => item.song)) ?? [];
  const downloadedItems = groupDownloadedLibrary(downloads.data ?? []);
  const loading =
    ((section === "albums" || section === "songs") && catalog.isPending) ||
    (section === "artists" && artists.isPending) ||
    (section === "liked" && liked.isPending) ||
    (section === "downloads" && downloads.isPending) ||
    (section === "playlists" && playlists.isPending);
  const failed =
    ((section === "albums" || section === "songs") && catalog.isError) ||
    (section === "artists" && artists.isError) ||
    (section === "liked" && liked.isError) ||
    (section === "downloads" && downloads.isError) ||
    (section === "playlists" && playlists.isError);
  const empty =
    (section === "albums" && albumItems.length === 0) ||
    (section === "songs" && songItems.length === 0) ||
    (section === "artists" && artistItems.length === 0) ||
    (section === "liked" && likedSongs.length === 0);
  const retry = () => {
    if (section === "albums" || section === "songs") void catalog.refetch();
    else if (section === "artists") void artists.refetch();
    else if (section === "liked") void liked.refetch();
    else if (section === "downloads") void downloads.refetch();
    else void playlists.refetch();
  };
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <PageTitle>Library</PageTitle>
        {session.phase === "offline" ? (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineTitle}>Offline downloads</Text>
            <Text style={styles.offlineText}>
              Your server is unavailable. Downloaded music still works.
            </Text>
            {session.error ? (
              <Text accessibilityRole="alert" style={styles.offlineError}>
                {session.error}
              </Text>
            ) : null}
            <View style={styles.offlineActions}>
              <Pressable
                accessibilityRole="button"
                style={styles.offlinePrimary}
                onPress={() => void session.retry()}
              >
                <Text style={styles.offlinePrimaryText}>Reconnect</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                style={styles.offlineSecondary}
                onPress={() => void session.changeServer()}
              >
                <Text style={styles.offlineSecondaryText}>Change library</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <ScrollView
          horizontal
          style={styles.pillScroller}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
        >
          {(
            (session.phase === "offline"
              ? ["downloads"]
              : [
                  "albums",
                  "songs",
                  "downloads",
                  "liked",
                  "artists",
                  "playlists",
                ]) as readonly Section[]
          ).map((value) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: section === value }}
              key={value}
              onPress={() => setSection(value)}
              style={[styles.pill, section === value && styles.activePill]}
            >
              <Text
                style={[
                  styles.pillText,
                  section === value && styles.activePillText,
                ]}
              >
                {value === "liked"
                  ? "Liked Songs"
                  : `${value[0]?.toUpperCase()}${value.slice(1)}`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {loading ? (
          <ActivityIndicator color="white" style={{ marginTop: 60 }} />
        ) : failed ? (
          <Pressable
            accessibilityRole="button"
            style={styles.errorState}
            onPress={retry}
          >
            <Text style={styles.errorTitle}>Could not load this section</Text>
            <Text style={styles.errorText}>Tap to try again</Text>
          </Pressable>
        ) : (
          <ScrollView
            style={styles.results}
            contentContainerStyle={{
              paddingTop: 8,
              paddingBottom: layout.tabBar + layout.miniPlayer + 28,
            }}
          >
            {section === "playlists" ? (
              <Pressable
                accessibilityLabel="Create playlist"
                accessibilityRole="button"
                style={styles.newPlaylist}
                onPress={() => setCreatingPlaylist(true)}
              >
                <Text style={styles.newPlaylistText}>＋ New playlist</Text>
              </Pressable>
            ) : null}
            {section === "liked" && likedSongs.length > 1 ? (
              <Pressable
                accessibilityLabel="Shuffle liked songs"
                accessibilityRole="button"
                style={styles.shuffleCollection}
                onPress={() => player.playShuffled(likedSongs)}
              >
                <Shuffle color="white" size={18} />
                <Text style={styles.shuffleCollectionText}>Shuffle</Text>
              </Pressable>
            ) : null}
            {empty ? (
              <View style={styles.emptyDownloads}>
                <Text style={styles.emptyDownloadsTitle}>
                  {section === "liked"
                    ? "No liked songs yet"
                    : `No ${section} found`}
                </Text>
                <Text style={styles.emptyDownloadsText}>
                  {section === "liked"
                    ? "Songs you like will appear here."
                    : "Refresh or index your library from Settings."}
                </Text>
              </View>
            ) : null}
            {section === "albums" &&
              albumItems.map((album) => (
                <Pressable
                  accessibilityLabel={`${album.name} by ${album.artistName}`}
                  accessibilityRole="button"
                  key={album.id}
                  style={styles.row}
                  onPress={() => {
                    if (!selectedAlbum) router.push(`/album/${album.id}`);
                  }}
                  onLongPress={() => setSelectedAlbum(album)}
                >
                  <Artwork path={album.coverPath} size={58} />
                  <View style={styles.labels}>
                    <Text numberOfLines={1} style={styles.name}>
                      {album.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      Album • {album.artistName} • {album.songCount} songs
                    </Text>
                  </View>
                </Pressable>
              ))}
            {section === "songs" &&
              playableSongs.map((song) => (
                <SongRow key={song.id} song={song} queue={playableSongs} />
              ))}
            {section === "downloads" &&
              downloadedItems.map((item) =>
                item.kind === "album" ? (
                  <Pressable
                    accessibilityLabel={`${item.album.name} by ${
                      item.album.artist_object?.name ??
                      item.album.contributing_artists?.[0] ??
                      "Unknown artist"
                    }`}
                    accessibilityRole="button"
                    key={`album-${item.album.id}`}
                    style={styles.row}
                    onPress={() => {
                      client.setQueryData(["album", item.album.id], item.album);
                      router.push(`/album/${item.album.id}`);
                    }}
                    onLongPress={() => setSelectedDownloadedAlbum(item.album)}
                  >
                    <Artwork path={item.album.cover_url} size={58} />
                    <View style={styles.labels}>
                      <Text numberOfLines={1} style={styles.name}>
                        {item.album.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {item.album.artist_object?.name ??
                          item.album.contributing_artists?.[0] ??
                          "Unknown artist"}
                      </Text>
                    </View>
                  </Pressable>
                ) : (
                  <SongRow
                    key={item.song.id}
                    song={item.song}
                    queue={downloads.data}
                  />
                ),
              )}
            {section === "downloads" && downloads.data?.length === 0 ? (
              <View style={styles.emptyDownloads}>
                <Text style={styles.emptyDownloadsTitle}>No downloads yet</Text>
                <Text style={styles.emptyDownloadsText}>
                  Downloaded songs and albums will appear here for offline
                  playback.
                </Text>
              </View>
            ) : null}
            {section === "artists" &&
              artistItems.map((artist) => (
                <Pressable
                  accessibilityLabel={artist.name}
                  accessibilityRole="button"
                  key={artist.id}
                  style={styles.row}
                  onPress={() => {
                    if (!selectedArtist) router.push(`/artist/${artist.id}`);
                  }}
                  onLongPress={() => setSelectedArtist(artist)}
                >
                  <View style={styles.labels}>
                    <Text numberOfLines={1} style={styles.name}>
                      {artist.name}
                    </Text>
                    <Text style={styles.meta}>
                      Artist • {artist.albumCount} albums
                    </Text>
                  </View>
                </Pressable>
              ))}
            {section === "liked" &&
              likedSongs.map((song) => (
                <View key={song.id}>
                  <SongRow song={song} queue={likedSongs} />
                </View>
              ))}
            {(section === "albums" || section === "songs") &&
            catalog.hasNextPage ? (
              <LoadMore
                loading={catalog.isFetchingNextPage}
                onPress={() => void catalog.fetchNextPage()}
              />
            ) : null}
            {section === "artists" && artists.hasNextPage ? (
              <LoadMore
                loading={artists.isFetchingNextPage}
                onPress={() => void artists.fetchNextPage()}
              />
            ) : null}
            {section === "liked" && liked.hasNextPage ? (
              <LoadMore
                loading={liked.isFetchingNextPage}
                onPress={() => void liked.fetchNextPage()}
              />
            ) : null}
            {section === "playlists" ? (
              <View style={styles.playlistGrid}>
                <Pressable
                  accessibilityLabel="Open Liked Songs"
                  accessibilityRole="button"
                  style={[styles.playlistCard, { width: playlistCardSize }]}
                  onPress={() => setSection("liked")}
                >
                  <LinearGradient
                    colors={["#f43f5e", "#86198f"]}
                    style={[
                      styles.squarePlaylistCover,
                      { width: playlistCardSize, height: playlistCardSize },
                    ]}
                  >
                    <Heart color="white" fill="white" size={44} />
                  </LinearGradient>
                  <Text numberOfLines={2} style={styles.playlistCardTitle}>
                    Liked Songs
                  </Text>
                </Pressable>
                {playlists.data?.map((playlist) => (
                  <Pressable
                    accessibilityLabel={`${playlist.name}, ${playlist.song_count} songs`}
                    accessibilityRole="button"
                    key={playlist.id}
                    style={[styles.playlistCard, { width: playlistCardSize }]}
                    onPress={() => {
                      if (!selectedPlaylist)
                        router.push(`/playlist/${playlist.id}`);
                    }}
                    onLongPress={() => setSelectedPlaylist(playlist)}
                  >
                    <PlaylistCover
                      size={playlistCardSize}
                      songs={playlist.cover_songs}
                      override={playlist.cover_image}
                    />
                    <Text numberOfLines={2} style={styles.playlistCardTitle}>
                      {playlist.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
        {selectedAlbum ? (
          <AlbumActions
            open
            albumId={selectedAlbum.id}
            artistId={selectedAlbum.artistId}
            name={selectedAlbum.name}
            onClose={() => setSelectedAlbum(null)}
          />
        ) : null}
        {selectedDownloadedAlbum ? (
          <AlbumActions
            open
            albumId={selectedDownloadedAlbum.id}
            artistId={selectedDownloadedAlbum.artist_object?.id}
            name={selectedDownloadedAlbum.name}
            loaded={selectedDownloadedAlbum}
            onClose={() => setSelectedDownloadedAlbum(null)}
          />
        ) : null}
        {selectedArtist ? (
          <ArtistActions
            open
            artistId={selectedArtist.id}
            name={selectedArtist.name}
            onClose={() => setSelectedArtist(null)}
          />
        ) : null}
        {selectedPlaylist ? (
          <PlaylistActions
            open
            playlistId={selectedPlaylist.id}
            name={selectedPlaylist.name}
            onClose={() => setSelectedPlaylist(null)}
          />
        ) : null}
        <PlaylistPicker
          open={creatingPlaylist}
          onClose={() => setCreatingPlaylist(false)}
        />
      </SafeAreaView>
    </Screen>
  );
}

function LoadMore({
  loading,
  onPress,
}: {
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      style={styles.loadMore}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color="white" />
      ) : (
        <Text style={styles.loadMoreText}>Load more</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillScroller: { flexGrow: 0, flexShrink: 0 },
  pills: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  results: { flex: 1 },
  shuffleCollection: {
    alignSelf: "flex-end",
    minHeight: 40,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingHorizontal: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shuffleCollectionText: { color: "white", fontWeight: "700" },
  newPlaylist: {
    alignSelf: "flex-end",
    minHeight: 40,
    justifyContent: "center",
    marginHorizontal: 20,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "white",
  },
  newPlaylistText: { color: "black", fontWeight: "800" },
  pill: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    paddingHorizontal: 15,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
  },
  activePill: { backgroundColor: "white" },
  pillText: { color: "white", fontSize: 13, fontWeight: "700" },
  activePillText: { color: "black" },
  row: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 13,
  },
  playlistGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  playlistCard: { minWidth: 0 },
  squarePlaylistCover: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  playlistCardTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 9,
  },
  labels: { flex: 1 },
  name: { color: "white", fontWeight: "700", fontSize: 15 },
  meta: { color: palette.secondary, fontSize: 13, marginTop: 4 },
  loadMore: {
    height: 52,
    margin: 20,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyDownloads: { alignItems: "center", padding: 40, marginTop: 28 },
  emptyDownloadsTitle: { color: "white", fontSize: 18, fontWeight: "800" },
  emptyDownloadsText: {
    color: palette.secondary,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  offlineBanner: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,.08)",
  },
  offlineTitle: { color: "white", fontWeight: "800", fontSize: 14 },
  offlineText: { color: palette.secondary, fontSize: 13, marginTop: 4 },
  offlineError: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  offlineActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  offlinePrimary: {
    minHeight: 40,
    flex: 1,
    borderRadius: 20,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  offlinePrimaryText: { color: "black", fontSize: 13, fontWeight: "800" },
  offlineSecondary: {
    minHeight: 40,
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  offlineSecondaryText: { color: "white", fontSize: 13, fontWeight: "700" },
  loadMoreText: { color: "white", fontWeight: "700" },
  errorState: { alignItems: "center", padding: 36, marginTop: 28 },
  errorTitle: { color: "white", fontSize: 16, fontWeight: "800" },
  errorText: { color: palette.secondary, marginTop: 6 },
});
