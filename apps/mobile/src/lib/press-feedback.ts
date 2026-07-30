import type { PressableProps } from "react-native";

type ImmediatePressFeedback = Pick<
  PressableProps,
  "android_ripple" | "unstable_pressDelay"
>;

export const immediatePressFeedback = {
  android_ripple: {
    color: "rgba(255, 255, 255, 0.12)",
    foreground: true,
  },
  unstable_pressDelay: 0,
} satisfies ImmediatePressFeedback;

export const immediateBorderlessPressFeedback = {
  android_ripple: {
    borderless: true,
    color: "rgba(255, 255, 255, 0.16)",
    foreground: true,
  },
  unstable_pressDelay: 0,
} satisfies ImmediatePressFeedback;
