import { StyleSheet, View } from "react-native";

export function PauseGlyph({
  color = "white",
  size = 24,
}: {
  color?: string;
  size?: number;
}) {
  const barWidth = Math.max(4, Math.round(size * 0.28));
  return (
    <View
      style={[
        styles.row,
        {
          width: size,
          height: size,
          gap: Math.max(3, Math.round(size * 0.18)),
        },
      ]}
    >
      <View style={[styles.bar, { width: barWidth, backgroundColor: color }]} />
      <View style={[styles.bar, { width: barWidth, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
  },
  bar: { height: "100%", borderRadius: 1 },
});
