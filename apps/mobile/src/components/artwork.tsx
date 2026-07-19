import { Image } from "expo-image";
import { Music2 } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

import { palette } from "@/constants/colors";
import { imageUrl } from "@/lib/runtime";

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
  const uri = imageUrl(path);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  return (
    <View
      style={[
        styles.frame,
        { width: size, height: size, borderRadius: rounded },
        style,
      ]}
    >
      {uri && failedUri !== uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          onError={() => setFailedUri(uri)}
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
