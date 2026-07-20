import { Image } from "expo-image";
import { Music2 } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { palette } from "@/constants/colors";
import { imageUrl } from "@/lib/runtime";
import { useSession } from "@/providers/session-provider";

export function Artwork({
  path,
  size,
  rounded = 8,
  style,
}: {
  path?: string | null;
  size: number;
  rounded?: number;
  style?: ViewStyle;
}) {
  const session = useSession();
  const uri = imageUrl(path);
  const sourceKey = uri ? `${session.phase}:${uri}` : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failures = useRef(new Map<string, number>());
  useEffect(() => {
    if (!failedSource) return;
    const attempts = failures.current.get(failedSource) ?? 0;
    if (attempts >= 3) return;
    const retry = setTimeout(
      () =>
        setFailedSource((current) =>
          current === failedSource ? null : current,
        ),
      1200 * attempts,
    );
    return () => clearTimeout(retry);
  }, [failedSource]);
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: rounded },
        style,
      ]}
    >
      {uri && failedSource !== sourceKey ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          onError={() => {
            if (!sourceKey) return;
            failures.current.set(
              sourceKey,
              (failures.current.get(sourceKey) ?? 0) + 1,
            );
            setFailedSource(sourceKey);
          }}
          transition={160}
        />
      ) : (
        <Music2 color={palette.muted} size={Math.max(18, size * 0.28)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: palette.elevatedStrong,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
