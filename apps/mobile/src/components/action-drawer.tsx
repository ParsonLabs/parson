/* eslint-disable react-hooks/immutability, react-hooks/refs -- Reanimated SharedValues are mutated only inside UI-thread gesture worklets. */
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

type DrawerRequest = {
  children: React.ReactNode;
  id: symbol;
  onClose: () => void;
  title?: string;
};

type DrawerPortal = {
  dismiss: (id: symbol) => void;
  present: (request: DrawerRequest) => void;
};

const DrawerPortalContext = createContext<DrawerPortal | null>(null);

export function ActionDrawerProvider({ children }: PropsWithChildren) {
  const [request, setRequest] = useState<DrawerRequest | null>(null);
  const present = useCallback((next: DrawerRequest) => setRequest(next), []);
  const dismiss = useCallback(
    (id: symbol) =>
      setRequest((current) => (current?.id === id ? null : current)),
    [],
  );
  const portal = useMemo(() => ({ dismiss, present }), [dismiss, present]);
  return (
    <DrawerPortalContext.Provider value={portal}>
      <View style={styles.provider}>
        {children}
        <ActionDrawerHost request={request} />
      </View>
    </DrawerPortalContext.Provider>
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
  const portal = useContext(DrawerPortalContext);
  const id = useRef(Symbol("action-drawer"));
  useLayoutEffect(() => {
    if (!portal) return;
    if (open) portal.present({ children, id: id.current, onClose, title });
    else portal.dismiss(id.current);
  }, [children, onClose, open, portal, title]);
  useEffect(
    () => () => {
      portal?.dismiss(id.current);
    },
    [portal],
  );
  return null;
}

function ActionDrawerHost({ request }: { request: DrawerRequest | null }) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const offscreenDistance = Math.max(900, screenHeight);
  const entranceDistance = 64;
  const translateY = useSharedValue(offscreenDistance);
  const requestRef = useRef(request);
  const requestId = request?.id;
  const closeDrawer = useCallback(() => {
    const active = requestRef.current;
    if (active && active.id === requestId) active.onClose();
  }, [requestId]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useLayoutEffect(() => {
    if (requestId) {
      translateY.value = entranceDistance;
      translateY.value = withTiming(0, { duration: 120 });
    }
  }, [requestId, translateY]);

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
    if (!request) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        dismissDrawer();
        return true;
      },
    );
    return () => subscription.remove();
  }, [dismissDrawer, request]);
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
  if (!request) return null;
  return (
    <View style={styles.modal}>
      <Animated.View
        pointerEvents="none"
        style={[styles.backdrop, backdropStyle]}
      />
      <Pressable style={StyleSheet.absoluteFill} onPress={dismissDrawer} />
      <GestureDetector gesture={dragGesture}>
        <Animated.View
          style={[
            styles.drawer,
            { paddingBottom: Math.max(16, insets.bottom) },
            drawerStyle,
          ]}
        >
          <View style={styles.handle} />
          {request.title ? (
            <Text numberOfLines={1} style={styles.title}>
              {request.title}
            </Text>
          ) : null}
          {request.children}
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
