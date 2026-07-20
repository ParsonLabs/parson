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
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
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

const ActionDrawerContext = createContext<(id: symbol, open: boolean) => void>(
  () => undefined,
);

export function ActionDrawerProvider({ children }: PropsWithChildren) {
  const openDrawers = useRef(new Set<symbol>());
  const [hasOpenDrawer, setHasOpenDrawer] = useState(false);
  const registerDrawer = useCallback((id: symbol, open: boolean) => {
    if (open) openDrawers.current.add(id);
    else openDrawers.current.delete(id);
    setHasOpenDrawer(openDrawers.current.size > 0);
  }, []);

  return (
    <ActionDrawerContext.Provider value={registerDrawer}>
      <View
        aria-hidden={hasOpenDrawer}
        accessibilityElementsHidden={hasOpenDrawer}
        importantForAccessibility={
          hasOpenDrawer ? "no-hide-descendants" : "auto"
        }
        style={styles.provider}
      >
        {children}
      </View>
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
  const insets = useSafeAreaInsets();
  const registerDrawer = useContext(ActionDrawerContext);
  const drawerId = useRef(Symbol("action-drawer"));
  const { height: screenHeight } = useWindowDimensions();
  const offscreenDistance = Math.max(900, screenHeight);
  const entranceDistance = 64;
  const translateY = useSharedValue(offscreenDistance);
  const closeDrawer = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const id = drawerId.current;
    registerDrawer(id, open);
    return () => registerDrawer(id, false);
  }, [open, registerDrawer]);

  useLayoutEffect(() => {
    if (open) {
      translateY.value = entranceDistance;
      translateY.value = withTiming(0, { duration: 120 });
    } else {
      translateY.value = offscreenDistance;
    }
  }, [entranceDistance, offscreenDistance, open, translateY]);

  const dismissDrawer = useCallback(() => {
    translateY.value = withTiming(offscreenDistance, { duration: 140 }, () => {
      runOnJS(closeDrawer)();
    });
  }, [closeDrawer, offscreenDistance, translateY]);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateY.value,
      [0, Math.min(300, offscreenDistance)],
      [0.54, 0],
      Extrapolation.CLAMP,
    ),
  }));
  useEffect(() => {
    if (!open || Platform.OS === "web") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        dismissDrawer();
        return true;
      },
    );
    return () => subscription.remove();
  }, [dismissDrawer, open]);
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-30, 30])
        .onUpdate(({ translationY }) => {
          translateY.value = Math.max(0, translationY);
        })
        .onEnd(({ translationY, velocityY }) => {
          if (translationY > 110 || velocityY > 850) {
            translateY.value = withTiming(
              offscreenDistance,
              { duration: 140 },
              () => {
                runOnJS(closeDrawer)();
              },
            );
          } else {
            translateY.value = withSpring(0, {
              damping: 22,
              stiffness: 260,
            });
          }
        }),
    [closeDrawer, offscreenDistance, translateY],
  );
  return (
    <Modal
      animationType="none"
      onRequestClose={dismissDrawer}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={open}
    >
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
            {title ? (
              <Text numberOfLines={1} style={styles.title}>
                {title}
              </Text>
            ) : null}
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
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
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.55 }]}
      onPress={onPress}
    >
      {Icon ? <Icon color="white" size={21} /> : null}
      <Text style={styles.label}>{label}</Text>
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
  label: { color: "white", fontSize: 16, fontWeight: "600" },
});
