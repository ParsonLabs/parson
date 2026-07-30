import { CastButton } from "react-native-google-cast";

export function CastOutputButton() {
  return (
    <CastButton
      accessibilityLabel="Play on a Cast device"
      style={{ height: 32, tintColor: "white", width: 32 }}
    />
  );
}
