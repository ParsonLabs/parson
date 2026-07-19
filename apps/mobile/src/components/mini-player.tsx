/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are mutated only inside gesture worklets. */
import { useRouter } from "expo-router";
import { Play, SkipForward } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { Artwork } from "@/components/artwork";
import { PauseGlyph } from "@/components/pause-glyph";
import { layout, palette } from "@/constants/colors";
import { usePlayer, usePlayerPosition } from "@/providers/player-provider";

export function MiniPlayer({ bottom }: { bottom: number }) {
  const router = useRouter();
  const { current, isPlaying, toggle, next } = usePlayer();
  const { currentTime, duration } = usePlayerPosition();
  const [opening, setOpening] = useState(false);
  const expansion = useSharedValue(0);
  const openPlayerFromDrag = useCallback(() => {
    setOpening(true);
    router.push("/player");
  }, [router]);
  const openPlayerFromTap = useCallback(() => {
    router.push("/player");
  }, [router]);
  const dragStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(
      expansion.value,
      [0, 180],
      [12, 0],
      Extrapolation.CLAMP,
    ),
    height: layout.miniPlayer + expansion.value,
    left: interpolate(expansion.value, [0, 180], [8, 0], Extrapolation.CLAMP),
    right: interpolate(expansion.value, [0, 180], [8, 0], Extrapolation.CLAMP),
  }));
  const dragUpGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(-12)
        .failOffsetX([-28, 28])
        .onUpdate(({ translationY }) => {
          expansion.value = Math.max(0, -translationY);
        })
        .onEnd(({ translationY, velocityY }) => {
          if (translationY < -36 || velocityY < -600) {
            runOnJS(openPlayerFromDrag)();
          } else {
            expansion.value = withSpring(0, {
              damping: 22,
              stiffness: 260,
            });
          }
        }),
    [expansion, openPlayerFromDrag],
  );
  if (!current || opening) return null;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  return (
    <GestureDetector gesture={dragUpGesture}>
      <Animated.View style={[styles.shell, { bottom }, dragStyle]}>
        <Pressable style={styles.info} onPress={openPlayerFromTap}>
          <Artwork
            path={current.album_object?.cover_url}
            size={48}
            rounded={7}
          />
          <View style={styles.labels}>
            <Text numberOfLines={1} style={styles.title}>
              {current.name}
            </Text>
            <Text numberOfLines={1} style={styles.artist}>
              {current.artist}
            </Text>
          </View>
        </Pressable>
        <Pressable hitSlop={10} style={styles.control} onPress={toggle}>
          {isPlaying ? (
            <PauseGlyph size={22} />
          ) : (
            <Play color="white" fill="white" size={23} />
          )}
        </Pressable>
        <Pressable hitSlop={10} style={styles.control} onPress={next}>
          <SkipForward color="white" fill="white" size={21} />
        </Pressable>
        <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: "absolute",
    left: 8,
    right: 8,
    height: layout.miniPlayer,
    borderRadius: 12,
    backgroundColor: "#202024",
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    zIndex: 20,
    overflow: "hidden",
  },
  info: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  labels: { flex: 1 },
  title: { color: palette.text, fontWeight: "700", fontSize: 14 },
  artist: { color: palette.secondary, fontSize: 12, marginTop: 2 },
  control: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  progress: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "white",
  },
});
