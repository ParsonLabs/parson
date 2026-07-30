import type { LibrarySong } from "@parson/music-sdk";
import { ListMusic } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { Artwork } from "@/components/artwork";
import { palette } from "@/constants/colors";

export function PlaylistCover({
  override,
  size,
  songs,
}: {
  override?: string | null;
  size: number;
  songs: LibrarySong[];
}) {
  if (override) return <Artwork path={override} rounded={10} size={size} />;
  const covers = songs
    .slice(0, 4)
    .map((song) => song.album_object?.cover_url)
    .filter((path): path is string => !!path);
  if (!covers.length) {
    return (
      <View
        style={[
          styles.cover,
          {
            width: size,
            height: size,
            backgroundColor: palette.elevatedStrong,
          },
        ]}
      >
        <ListMusic color={palette.muted} size={Math.round(size * 0.28)} />
      </View>
    );
  }
  if (new Set(covers).size === 1) {
    return <Artwork path={covers[0]} rounded={10} size={size} />;
  }
  const quadrants = Array.from(
    { length: 4 },
    (_, index) => covers[index % covers.length],
  );
  return (
    <View
      style={[styles.mosaic, { width: size, height: size, borderRadius: 10 }]}
    >
      {quadrants.map((path, index) => (
        <Artwork
          key={`${path}-${index}`}
          path={path}
          rounded={0}
          size={size / 2}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mosaic: {
    flexDirection: "row",
    flexWrap: "wrap",
    overflow: "hidden",
    backgroundColor: palette.elevatedStrong,
  },
});
