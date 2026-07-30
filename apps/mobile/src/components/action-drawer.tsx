/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are mutated only inside UI-thread gesture worklets. */
import type { LucideIcon } from "lucide-react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { palette } from "@/constants/colors";
import { immediatePressFeedback } from "@/lib/press-feedback";

type DrawerEntry = {
  children: React.ReactNode;
  id: number;
  onClose: () => void;
  title?: string;
};

type ActionDrawerController = {
  dismiss: (id: number) => void;
  present: (entry: DrawerEntry) => void;
};

const ActionDrawerContext = createContext<ActionDrawerController>({
  dismiss: () => undefined,
  present: () => undefined,
});
let nextDrawerId = 0;

export function ActionDrawerProvider({ children }: PropsWithChildren) {
  const activeId = useRef<number | null>(null);
  const entryRef = useRef<DrawerEntry | null>(null);
  const notifyOnDismiss = useRef(false);
  const [entry, setEntry] = useState<DrawerEntry | null>(null);
  const [shown, setShown] = useState(false);

  const present = useCallback((next: DrawerEntry) => {
    activeId.current = next.id;
    entryRef.current = next;
    notifyOnDismiss.current = false;
    setEntry(next);
    setShown(true);
  }, []);
  const dismiss = useCallback((id: number) => {
    if (activeId.current === id) {
      notifyOnDismiss.current = false;
      setShown(false);
    }
  }, []);
  const requestClose = useCallback(() => {
    notifyOnDismiss.current = true;
    setShown(false);
  }, []);
  const finishDismiss = useCallback((id: number) => {
    if (activeId.current !== id) return;
    activeId.current = null;
    const onClose =
      entryRef.current?.id === id ? entryRef.current.onClose : undefined;
    const notify = notifyOnDismiss.current;
    entryRef.current = null;
    notifyOnDismiss.current = false;
    setEntry(null);
    if (notify) onClose?.();
  }, []);
  const controller = useMemo(() => ({ dismiss, present }), [dismiss, present]);

  return (
    <ActionDrawerContext.Provider value={controller}>
      <View
        aria-hidden={Boolean(entry)}
        accessibilityElementsHidden={Boolean(entry)}
        importantForAccessibility={entry ? "no-hide-descendants" : "auto"}
        style={styles.provider}
      >
        {children}
      </View>
      {entry ? (
        <ActionDrawerHost
          entry={entry}
          shown={shown}
          onDismissed={finishDismiss}
          onRequestClose={requestClose}
        />
      ) : null}
    </ActionDrawerContext.Provider>
  );
}

export function ActionDrawer({
  children,
  onClose,
  open,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  open: boolean;
  title?: string;
}) {
  const controller = useContext(ActionDrawerContext);
  const drawerId = useRef(++nextDrawerId);
  const closeDrawer = useCallback(() => onClose(), [onClose]);

  useLayoutEffect(() => {
    const id = drawerId.current;
    if (open) {
      controller.present({ children, id, onClose: closeDrawer, title });
    } else {
      controller.dismiss(id);
    }
  }, [children, closeDrawer, controller, open, title]);
  useEffect(() => {
    const id = drawerId.current;
    return () => controller.dismiss(id);
  }, [controller]);

  return null;
}

function ActionDrawerHost({
  entry,
  shown,
  onDismissed,
  onRequestClose,
}: {
  entry: DrawerEntry;
  shown: boolean;
  onDismissed: (id: number) => void;
  onRequestClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const offscreenDistance = Math.max(900, screenHeight);
  const translateY = useSharedValue(offscreenDistance);
  const openProgress = useSharedValue(0);
  const entryId = useRef(entry.id);

  const drawerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      openProgress.value,
      [0, 0.55, 1],
      [0.72, 0.96, 1],
      Extrapolation.CLAMP,
    ),
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value * 0.54,
  }));

  useLayoutEffect(() => {
    if (shown) {
      entryId.current = entry.id;
      translateY.value = offscreenDistance;
      openProgress.value = 0;
      translateY.value = withTiming(0, {
        duration: 285,
        easing: Easing.bezier(0.2, 0, 0, 1),
      });
      openProgress.value = withTiming(1, {
        duration: 210,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    const closingId = entryId.current;
    openProgress.value = withTiming(0, {
      duration: 160,
      easing: Easing.in(Easing.cubic),
    });
    translateY.value = withTiming(
      offscreenDistance,
      {
        duration: 210,
        easing: Easing.bezier(0.4, 0, 1, 1),
      },
      () => {
        runOnJS(onDismissed)(closingId);
      },
    );
  }, [
    entry.id,
    offscreenDistance,
    onDismissed,
    openProgress,
    shown,
    translateY,
  ]);

  const dismissDrawer = useCallback(() => {
    onRequestClose();
  }, [onRequestClose]);

  useEffect(() => {
    if (!shown) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        dismissDrawer();
        return true;
      },
    );
    return () => subscription.remove();
  }, [dismissDrawer, shown]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-30, 30])
        .onUpdate(({ translationY }) => {
          translateY.value = Math.max(0, translationY);
          openProgress.value = interpolate(
            translateY.value,
            [0, offscreenDistance],
            [1, 0],
            Extrapolation.CLAMP,
          );
        })
        .onEnd(({ translationY, velocityY }) => {
          if (translationY > 110 || velocityY > 850) {
            runOnJS(dismissDrawer)();
          } else {
            openProgress.value = withTiming(1, {
              duration: 160,
              easing: Easing.out(Easing.cubic),
            });
            translateY.value = withSpring(0, {
              damping: 24,
              stiffness: 300,
            });
          }
        }),
    [dismissDrawer, offscreenDistance, openProgress, translateY],
  );

  return (
    <View accessibilityViewIsModal style={styles.modal}>
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, backdropStyle]}
      />
      <Pressable
        accessibilityLabel="Close actions"
        accessibilityRole="button"
        style={StyleSheet.absoluteFill}
        onPress={dismissDrawer}
      />
      <GestureDetector gesture={dragGesture}>
        <Animated.View
          style={[
            styles.drawer,
            { paddingBottom: Math.max(16, insets.bottom) },
            drawerStyle,
          ]}
        >
          <View style={styles.handle} />
          {entry.title ? (
            <Text numberOfLines={1} style={styles.title}>
              {entry.title}
            </Text>
          ) : null}
          {entry.children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export function DrawerAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon?: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      {...immediatePressFeedback}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.55 }]}
      onPress={onPress}
    >
      {Icon ? <Icon color="white" size={21} /> : null}
      <Text numberOfLines={2} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  provider: { flex: 1 },
  modal: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    zIndex: 1000,
    elevation: 1000,
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    backgroundColor: "black",
  },
  drawer: {
    backgroundColor: "#18181b",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 10,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#66666d",
    alignSelf: "center",
    marginBottom: 10,
  },
  title: {
    color: palette.secondary,
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  action: {
    minHeight: 53,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },
  label: {
    flex: 1,
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 21,
  },
});
