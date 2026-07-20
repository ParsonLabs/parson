import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function webStorage() {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

export async function getSecureItem(key: string) {
  try {
    if (Platform.OS !== "web") return await SecureStore.getItemAsync(key);
    return webStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setSecureItem(key: string, value: string) {
  try {
    if (Platform.OS !== "web") {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    webStorage()?.setItem(key, value);
  } catch {
    // Storage can be unavailable on locked devices or in private browsers.
  }
}

export async function deleteSecureItem(key: string) {
  try {
    if (Platform.OS !== "web") {
      await SecureStore.deleteItemAsync(key);
      return;
    }
    webStorage()?.removeItem(key);
  } catch {
    // Match missing-store semantics: deletion is already complete.
  }
}
