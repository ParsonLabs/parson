import Slider from "@react-native-community/slider";
/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are mutated only inside gesture worklets. */
import {
  addFavoriteSong,
  findLyrics,
  isFavoriteSong,
  removeFavoriteSong,
} from "@parson/music-sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  ChevronDown,
  ChevronLeft,
  ListMusic,
  Disc3,
  Download,
  ListEnd,
  ListPlus,
  MoreHorizontal,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Heart,
  Gauge,
  AudioLines,
  TimerReset,
  X,
  UserRound,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { Artwork } from "@/components/artwork";
import { ActionDrawer, DrawerAction } from "@/components/action-drawer";
import { SongRow } from "@/components/music-ui";
import { palette } from "@/constants/colors";
import {
  playerAudioPresets,
  usePlayer,
  usePlayerPosition,
  type AudioPreset,
} from "@/providers/player-provider";
import {
  downloadSong,
  isSongDownloaded,
  removeDownload,
  useDownloadsRevision,
} from "@/lib/downloads";
import { PlaylistPicker } from "@/components/playlist-picker";
import { PauseGlyph } from "@/components/pause-glyph";
import { useSession } from "@/providers/session-provider";

type Panel = "player" | "queue" | "lyrics";
const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);
const presetIcons = {
  original: AudioLines,
  slow: TimerReset,
  "deep-slow": TimerReset,
  faster: Gauge,
} satisfies Record<AudioPreset, typeof AudioLines>;

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

type Player = ReturnType<typeof usePlayer>;
type PlayerSong = NonNullable<Player["current"]>;
type Router = ReturnType<typeof useRouter>;
type SyncedLine = { at: number; text: string };

function PlayerHeader({
  panel,
  onBack,
  onActions,
}: {
  panel: Panel;
  onBack: () => void;
  onActions: () => void;
}) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel={
          panel === "player" ? "Close player" : "Back to player"
        }
        accessibilityRole="button"
        hitSlop={13}
        onPress={onBack}
      >
        {panel === "player" ? (
          <ChevronDown color="white" size={29} />
        ) : (
          <ChevronLeft color="white" size={29} />
        )}
      </Pressable>
      <Text style={styles.panelHeader}>
        {panel === "player" ? "" : panel === "lyrics" ? "Lyrics" : "Queue"}
      </Text>
      {panel === "player" ? (
        <Pressable
          accessibilityLabel="More player actions"
          accessibilityRole="button"
          hitSlop={13}
          onPress={onActions}
        >
          <MoreHorizontal color="white" size={25} />
        </Pressable>
      ) : (
        <View style={{ width: 25 }} />
      )}
    </View>
  );
}

function NowPlayingPanel({
  player,
  song,
  router,
  currentTime,
  duration,
  favorite,
  onToggleFavorite,
  onQueue,
  onLyrics,
  onSound,
  notice,
  online,
}: {
  player: Player;
  song: PlayerSong;
  router: Router;
  currentTime: number;
  duration: number;
  favorite: boolean;
  onToggleFavorite: () => void;
  onQueue: () => void;
  onLyrics: () => void;
  onSound: () => void;
  notice?: string | null;
  online: boolean;
}) {
  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  const settlingSeek = useRef<{ target: number; expiresAt: number } | null>(
    null,
  );
  useEffect(() => {
    const pending = settlingSeek.current;
    if (!pending) return;
    if (
      Math.abs(currentTime - pending.target) < 0.65 ||
      Date.now() >= pending.expiresAt
    ) {
      settlingSeek.current = null;
      setScrubPosition(null);
      return;
    }
    const timeout = setTimeout(
      () => {
        settlingSeek.current = null;
        setScrubPosition(null);
      },
      Math.max(0, pending.expiresAt - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [currentTime]);
  const shownTime = scrubPosition ?? currentTime;
  const presetLabel = playerAudioPresets.find(
    (preset) => preset.id === player.audioPreset,
  )?.label;
  return (
    <View style={styles.player}>
      <Artwork
        path={song.album_object?.cover_url}
        size={330}
        rounded={14}
        style={styles.art}
      />
      <View style={styles.songInfo}>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityLabel={`View album ${song.album_object?.name ?? song.name}`}
            accessibilityRole={song.album_object?.id ? "button" : undefined}
            numberOfLines={1}
            style={styles.title}
            onPress={() =>
              song.album_object?.id &&
              router.replace(`/album/${song.album_object.id}`)
            }
          >
            {song.name}
          </Text>
          <Text
            accessibilityLabel={`View artist ${song.artist}`}
            accessibilityRole={song.artist_object?.id ? "button" : undefined}
            numberOfLines={1}
            style={styles.artist}
            onPress={() =>
              song.artist_object?.id &&
              router.replace(`/artist/${song.artist_object.id}`)
            }
          >
            {song.artist}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={
            !online
              ? "Liked songs unavailable offline"
              : favorite
                ? "Remove from liked songs"
                : "Add to liked songs"
          }
          accessibilityRole="button"
          disabled={!online}
          hitSlop={12}
          style={!online ? styles.disabledControl : undefined}
          onPress={onToggleFavorite}
        >
          <Heart
            color={favorite ? palette.danger : "white"}
            fill={favorite ? palette.danger : "transparent"}
            size={25}
          />
        </Pressable>
      </View>
      <View style={styles.sliderHitbox}>
        <Slider
          accessibilityLabel="Playback position"
          minimumValue={0}
          maximumValue={Math.max(1, duration)}
          value={shownTime}
          onSlidingStart={setScrubPosition}
          onValueChange={setScrubPosition}
          onSlidingComplete={(target) => {
            setScrubPosition(target);
            settlingSeek.current = {
              target,
              expiresAt: Date.now() + 1_200,
            };
            player.seek(target);
          }}
          minimumTrackTintColor="white"
          maximumTrackTintColor="#66666d"
          thumbTintColor="white"
          style={styles.slider}
        />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{time(shownTime)}</Text>
        <Text style={styles.time}>
          -{time(Math.max(0, duration - shownTime))}
        </Text>
      </View>
      {notice ? (
        <Text accessibilityRole="alert" style={styles.playbackError}>
          {notice}
        </Text>
      ) : null}
      <View style={styles.controls}>
        <Pressable
          accessibilityLabel={`Repeat ${player.repeat}`}
          accessibilityRole="button"
          hitSlop={12}
          onPress={player.cycleRepeat}
        >
          {player.repeat === "one" ? (
            <Repeat1 color="white" size={24} />
          ) : (
            <Repeat
              color={player.repeat === "all" ? "white" : palette.muted}
              size={24}
            />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Previous song"
          accessibilityRole="button"
          hitSlop={14}
          onPress={player.previous}
        >
          <SkipBack color="white" fill="white" size={31} />
        </Pressable>
        <Pressable
          accessibilityLabel={player.isPlaying ? "Pause" : "Play"}
          accessibilityRole="button"
          style={styles.playButton}
          onPress={player.toggle}
        >
          {player.isPlaying ? (
            <PauseGlyph color="black" size={30} />
          ) : (
            <Play color="black" fill="black" size={34} />
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Next song"
          accessibilityRole="button"
          hitSlop={14}
          onPress={player.next}
        >
          <SkipForward color="white" fill="white" size={31} />
        </Pressable>
        <Pressable
          accessibilityLabel="Open queue"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onQueue}
        >
          <ListMusic color="white" size={24} />
        </Pressable>
      </View>
      <View style={styles.panelButtons}>
        <Pressable
          accessibilityRole="button"
          style={styles.panelButton}
          onPress={onLyrics}
        >
          <Text style={styles.panelText}>Lyrics</Text>
        </Pressable>
        {player.audioPresetsEnabled ? (
          <Pressable
            accessibilityLabel="Sound settings"
            accessibilityRole="button"
            style={styles.panelButton}
            onPress={onSound}
          >
            <Text style={styles.panelText}>
              {player.audioPreset === "original" ? "Sound" : presetLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function QueuePanel({ player }: { player: Player }) {
  return (
    <View style={styles.panel}>
      <ScrollView contentContainerStyle={{ paddingVertical: 10 }}>
        {player.queue.map((item, index) => (
          <SongRow
            key={`${item.id}-${index}`}
            song={item}
            queue={player.queue}
            index={index}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function LyricsPanel({
  pending,
  synced,
  plainLyrics,
  instrumental,
  currentTime,
  onSeek,
  failed,
  onRetry,
  offline,
}: {
  pending: boolean;
  synced: SyncedLine[];
  plainLyrics?: string | null;
  instrumental?: boolean;
  currentTime: number;
  onSeek: (seconds: number) => void;
  failed: boolean;
  onRetry: () => void;
  offline: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const lineLayouts = useRef(new Map<number, { height: number; y: number }>());
  const lastCenteredLine = useRef(-1);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const activeLine = synced.reduce(
    (found, line, index) => (line.at <= currentTime ? index : found),
    -1,
  );
  useEffect(() => {
    lineLayouts.current.clear();
    lastCenteredLine.current = -1;
  }, [synced]);
  useEffect(() => {
    const layout = lineLayouts.current.get(activeLine);
    if (!layout || !viewportHeight) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, layout.y - (viewportHeight - layout.height) / 2),
        animated: lastCenteredLine.current >= 0,
      });
      lastCenteredLine.current = activeLine;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeLine, contentHeight, viewportHeight]);
  return (
    <View style={styles.panel}>
      <ScrollView
        ref={scrollRef}
        onLayout={({ nativeEvent }) =>
          setViewportHeight(nativeEvent.layout.height)
        }
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        contentContainerStyle={[
          styles.lyricsContent,
          synced.length
            ? { paddingBottom: Math.max(24, viewportHeight / 2) }
            : null,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {offline ? (
          <View style={styles.emptyLyrics}>
            <Text style={styles.emptyTitle}>
              Lyrics are unavailable offline
            </Text>
          </View>
        ) : pending ? (
          <Text style={styles.loadingLyrics}>•••</Text>
        ) : failed ? (
          <Pressable
            accessibilityRole="button"
            style={styles.emptyLyrics}
            onPress={onRetry}
          >
            <Text style={styles.emptyTitle}>Could not load lyrics</Text>
            <Text style={styles.retryText}>Tap to try again</Text>
          </Pressable>
        ) : synced.length ? (
          synced.map((line, index) => {
            const captureLayout = ({
              nativeEvent,
            }: {
              nativeEvent: { layout: { height: number; y: number } };
            }) => lineLayouts.current.set(index, nativeEvent.layout);
            return line.text.trim() ? (
              <Text
                key={`${line.at}-${index}`}
                onPress={() => onSeek(line.at)}
                onLayout={captureLayout}
                style={[
                  styles.lyricLine,
                  index === activeLine
                    ? styles.activeLyric
                    : index < activeLine
                      ? styles.pastLyric
                      : styles.futureLyric,
                ]}
              >
                {line.text}
              </Text>
            ) : (
              <View
                key={`${line.at}-${index}`}
                onLayout={captureLayout}
                style={styles.lyricSpacer}
              />
            );
          })
        ) : plainLyrics ? (
          <Text style={styles.lyrics}>{plainLyrics}</Text>
        ) : (
          <View style={styles.emptyLyrics}>
            <Text style={styles.emptyTitle}>
              {instrumental
                ? "Instrumental"
                : "No lyrics are available for this track"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function PlayerDrawers({
  player,
  song,
  router,
  actionsOpen,
  onActionsClose,
  soundOpen,
  onSoundClose,
  online,
}: {
  player: Player;
  song: PlayerSong;
  router: Router;
  actionsOpen: boolean;
  onActionsClose: () => void;
  soundOpen: boolean;
  onSoundClose: () => void;
  online: boolean;
}) {
  const [playlistPicker, setPlaylistPicker] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  return (
    <>
      <ActionDrawer
        open={actionsOpen}
        onClose={onActionsClose}
        title={song.name}
      >
        <DrawerAction
          icon={ListPlus}
          label="Play next"
          onPress={() => {
            player.addNext(song);
            onActionsClose();
          }}
        />
        <DrawerAction
          icon={ListEnd}
          label="Add to queue"
          onPress={() => {
            player.addToQueue([song]);
            onActionsClose();
          }}
        />
        {online && song.album_object?.id ? (
          <DrawerAction
            icon={Disc3}
            label="View album"
            onPress={() => {
              onActionsClose();
              router.replace(`/album/${song.album_object.id}`);
            }}
          />
        ) : null}
        {online && song.artist_object?.id ? (
          <DrawerAction
            icon={UserRound}
            label="View artist"
            onPress={() => {
              onActionsClose();
              router.replace(`/artist/${song.artist_object.id}`);
            }}
          />
        ) : null}
        {online ? (
          <DrawerAction
            icon={ListPlus}
            label="Add to playlist"
            onPress={() => {
              onActionsClose();
              setPlaylistPicker(true);
            }}
          />
        ) : null}
        {online || isSongDownloaded(song.id) ? (
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
                  .then(onActionsClose)
                  .catch(() => setDownloadError(true));
                return;
              }
              setDownloadError(false);
              setDownloading(true);
              void downloadSong(song)
                .then(onActionsClose)
                .catch(() => setDownloadError(true))
                .finally(() => setDownloading(false));
            }}
          />
        ) : null}
        {downloadError ? (
          <Text accessibilityRole="alert" style={styles.drawerError}>
            The download action failed. Please try again.
          </Text>
        ) : null}
      </ActionDrawer>
      {player.audioPresetsEnabled ? (
        <ActionDrawer open={soundOpen} onClose={onSoundClose} title="Sound">
          {playerAudioPresets.map((preset) => (
            <DrawerAction
              key={preset.id}
              icon={presetIcons[preset.id]}
              label={`${player.audioPreset === preset.id ? "✓  " : ""}${preset.label}`}
              onPress={() => {
                player.setAudioPreset(preset.id);
                onSoundClose();
              }}
            />
          ))}
        </ActionDrawer>
      ) : null}
      <PlaylistPicker
        open={online && playlistPicker}
        onClose={() => setPlaylistPicker(false)}
        songId={song.id}
      />
    </>
  );
}

export default function PlayerScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const session = useSession();
  const player = usePlayer();
  const { currentTime, duration } = usePlayerPosition();
  const [panel, setPanel] = useState<Panel>("player");
  const [actions, setActions] = useState(false);
  const [soundOptions, setSoundOptions] = useState(false);
  const [favoriteErrorSong, setFavoriteErrorSong] = useState<string | null>(
    null,
  );
  const { height: screenHeight } = useWindowDimensions();
  const translateY = useSharedValue(0);
  const dismissPlayer = useCallback(() => router.back(), [router]);
  const playerDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const dragDownGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(panel === "player")
        .activeOffsetY(14)
        .failOffsetX([-28, 28])
        .onUpdate(({ translationY }) => {
          translateY.value = Math.max(0, translationY);
        })
        .onEnd(({ translationY, velocityY }) => {
          if (translationY > 72 || velocityY > 700) {
            translateY.value = withTiming(
              screenHeight,
              { duration: 170 },
              () => {
                runOnJS(dismissPlayer)();
              },
            );
          } else {
            translateY.value = withSpring(0, { damping: 22, stiffness: 260 });
          }
        }),
    [dismissPlayer, panel, screenHeight, translateY],
  );
  useDownloadsRevision();
  const lyrics = useQuery({
    queryKey: ["lyrics", player.current?.id],
    queryFn: () => findLyrics(player.current!.id),
    enabled:
      panel === "lyrics" && !!player.current && session.phase === "ready",
    staleTime: 30 * 60_000,
    retry: false,
  });
  const favorite = useQuery({
    queryKey: ["favorite-membership", player.current?.id],
    queryFn: () => isFavoriteSong(player.current!.id),
    enabled: !!player.current && session.phase === "ready",
    staleTime: 30_000,
  });
  const synced = useMemo(() => {
    const source = lyrics.data?.syncedLyrics;
    if (!source) return [];
    return source.split("\n").flatMap((line) => {
      const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
      return match
        ? [
            {
              at: Number(match[1]) * 60 + Number(match[2]),
              text: match[3] ?? "",
            },
          ]
        : [];
    });
  }, [lyrics.data?.syncedLyrics]);
  if (!player.current)
    return (
      <View style={styles.page}>
        <SafeAreaView>
          <Pressable
            accessibilityLabel="Close player"
            accessibilityRole="button"
            style={styles.down}
            onPress={router.back}
          >
            <ChevronDown color="white" />
          </Pressable>
        </SafeAreaView>
      </View>
    );
  const song = player.current;
  const toggleFavorite = async () => {
    if (session.phase !== "ready") return;
    setFavoriteErrorSong(null);
    const next = !favorite.data;
    client.setQueryData(["favorite-membership", song.id], next);
    try {
      if (next) await addFavoriteSong(song.id);
      else await removeFavoriteSong(song.id);
      await client.invalidateQueries({ queryKey: ["favorite-song-details"] });
    } catch {
      client.setQueryData(["favorite-membership", song.id], !next);
      setFavoriteErrorSong(song.id);
    }
  };
  return (
    <GestureDetector gesture={dragDownGesture}>
      <AnimatedLinearGradient
        colors={["#27272c", "#08080a", "#000"]}
        style={[styles.page, playerDragStyle]}
      >
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
          <PlayerHeader
            panel={panel}
            onBack={() =>
              panel === "player" ? router.back() : setPanel("player")
            }
            onActions={() => setActions(true)}
          />
          {panel === "player" ? (
            <NowPlayingPanel
              player={player}
              song={song}
              router={router}
              currentTime={currentTime}
              duration={duration}
              favorite={!!favorite.data}
              onToggleFavorite={() => void toggleFavorite()}
              onQueue={() => setPanel("queue")}
              onLyrics={() => setPanel("lyrics")}
              onSound={() => setSoundOptions(true)}
              notice={
                player.error ??
                (favoriteErrorSong === song.id
                  ? "Could not update liked songs."
                  : null)
              }
              online={session.phase === "ready"}
            />
          ) : panel === "queue" ? (
            <QueuePanel player={player} />
          ) : (
            <LyricsPanel
              pending={lyrics.isPending}
              synced={synced}
              plainLyrics={lyrics.data?.plainLyrics}
              instrumental={lyrics.data?.instrumental}
              currentTime={currentTime}
              onSeek={player.seek}
              failed={lyrics.isError}
              onRetry={() => void lyrics.refetch()}
              offline={session.phase === "offline"}
            />
          )}
          <PlayerDrawers
            player={player}
            song={song}
            router={router}
            actionsOpen={actions}
            onActionsClose={() => setActions(false)}
            soundOpen={soundOptions}
            onSoundClose={() => setSoundOptions(false)}
            online={session.phase === "ready"}
          />
        </SafeAreaView>
      </AnimatedLinearGradient>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "black" },
  down: { padding: 20 },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  panelHeader: { color: "white", fontSize: 15, fontWeight: "800" },
  playbackError: {
    color: "#fb7185",
    fontSize: 13,
    textAlign: "center",
  },
  disabledControl: { opacity: 0.4 },
  retryText: { color: palette.secondary, fontSize: 14, marginTop: 8 },
  player: { flex: 1, paddingHorizontal: 26, justifyContent: "space-evenly" },
  art: { alignSelf: "center", maxWidth: "100%", aspectRatio: 1 },
  songInfo: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  title: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  artist: { color: palette.secondary, fontSize: 16, marginTop: 5 },
  sliderHitbox: {
    width: "100%",
    height: 52,
    marginTop: 2,
    justifyContent: "center",
  },
  slider: { width: "100%", height: 52 },
  times: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -12,
  },
  time: {
    color: palette.secondary,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 10,
  },
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  panelButtons: { flexDirection: "row", gap: 8 },
  panelButton: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  panelText: { color: "white", fontWeight: "800" },
  panel: { flex: 1, paddingTop: 18 },
  panelTitle: {
    color: "white",
    fontSize: 30,
    fontWeight: "900",
    paddingHorizontal: 20,
  },
  lyrics: {
    color: "white",
    fontSize: 24,
    lineHeight: 35,
    fontWeight: "700",
    paddingHorizontal: 24,
    textAlign: "center",
  },
  lyricLine: {
    color: "white",
    fontSize: 25,
    lineHeight: 34,
    fontWeight: "800",
    paddingHorizontal: 24,
    paddingVertical: 7,
    textAlign: "center",
  },
  lyricsContent: {
    flexGrow: 1,
    paddingVertical: 24,
  },
  activeLyric: { color: "white", transform: [{ scale: 1.03 }] },
  pastLyric: { color: "rgba(255,255,255,.25)" },
  futureLyric: { color: "rgba(255,255,255,.45)" },
  lyricSpacer: { height: 20 },
  loadingLyrics: {
    color: palette.secondary,
    fontSize: 24,
    textAlign: "center",
    marginTop: 40,
    letterSpacing: 5,
  },
  emptyLyrics: {
    padding: 24,
    margin: 20,
    backgroundColor: "rgba(255,255,255,.08)",
    borderRadius: 16,
  },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 18 },
  emptyDetail: { color: palette.secondary, lineHeight: 20, marginTop: 8 },
  drawerError: { color: "#ff9b9b", paddingHorizontal: 16, paddingVertical: 8 },
});
