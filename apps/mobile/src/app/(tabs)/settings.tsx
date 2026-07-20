import {
  changePassword,
  indexLibrary,
  refreshCurrentLibrary,
  register,
  setBitrate,
} from "@parson/music-sdk";
import { LogOut, Radio, Server } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PageTitle, Screen } from "@/components/music-ui";
import { layout, palette } from "@/constants/colors";
import { useSession } from "@/providers/session-provider";

type Tab = "account" | "playback" | "server" | "library" | "users";
const labels: Record<Tab, string> = {
  account: "Account",
  playback: "Playback",
  server: "Server",
  library: "Library",
  users: "Users",
};

export default function SettingsScreen() {
  const router = useRouter();
  const session = useSession();
  const admin = session.claims?.role === "admin";
  const tabs: Tab[] =
    session.phase === "offline"
      ? ["account", "server"]
      : admin
        ? ["account", "playback", "server", "library", "users"]
        : ["account", "playback", "server"];
  const [tab, setTab] = useState<Tab>("account");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [quality, setQuality] = useState(session.claims?.bitrate ?? 0);
  const [message, setMessage] = useState("");
  const [libraryPath, setLibraryPath] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserAdmin, setNewUserAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const beginOperation = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const finishOperation = () => {
    busyRef.current = false;
    setBusy(false);
  };
  const leaveAuthenticatedApp = async (action: () => Promise<void>) => {
    await action();
    if (Platform.OS === "web") globalThis.location.replace("/");
    else router.replace("/");
  };
  const savePassword = async () => {
    if (!beginOperation()) return;
    setMessage("Updating password…");
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated. Sign in again with your new password.");
      await leaveAuthenticatedApp(session.logout);
    } catch {
      setMessage("Could not update password.");
    } finally {
      finishOperation();
    }
  };
  const saveQuality = async (bitrate: number) => {
    if (!beginOperation()) return;
    const previous = quality;
    setQuality(bitrate);
    setMessage("Updating quality…");
    try {
      await setBitrate(bitrate);
      session.updateBitrate(bitrate);
      setMessage("Quality updated.");
    } catch {
      setQuality(previous);
      setMessage("Could not update quality.");
    } finally {
      finishOperation();
    }
  };
  const indexFolder = async () => {
    if (!libraryPath.trim() || !beginOperation()) return;
    setMessage("Indexing…");
    try {
      const result = await indexLibrary(libraryPath.trim());
      setMessage(
        `Library updated · ${result.report.indexed_files} songs indexed.`,
      );
    } catch {
      setMessage("Could not index this folder.");
    } finally {
      finishOperation();
    }
  };
  const refreshLibrary = async () => {
    if (!beginOperation()) return;
    setMessage("Refreshing…");
    try {
      const result = await refreshCurrentLibrary();
      setMessage(
        `Refreshed ${result.refreshed.length} library folder${result.refreshed.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setMessage("Current library could not be refreshed.");
    } finally {
      finishOperation();
    }
  };
  const createUser = async () => {
    if (
      newUsername.trim().length < 2 ||
      newUserPassword.length < 8 ||
      !beginOperation()
    )
      return;
    setMessage("Creating…");
    try {
      const result = await register({
        username: newUsername.trim(),
        password: newUserPassword,
        role: newUserAdmin ? "admin" : "user",
      });
      if (!result.status) {
        setMessage("Could not create user.");
        return;
      }
      setNewUsername("");
      setNewUserPassword("");
      setNewUserAdmin(false);
      setMessage("User created.");
    } catch {
      setMessage("Could not create user.");
    } finally {
      finishOperation();
    }
  };
  return (
    <Screen>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            paddingBottom: layout.tabBar + layout.miniPlayer + 28,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <PageTitle>Settings</PageTitle>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {tabs.map((value) => (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === value }}
                disabled={busy}
                key={value}
                style={[
                  styles.tab,
                  tab === value && styles.activeTab,
                  busy && styles.disabled,
                ]}
                onPress={() => {
                  setTab(value);
                  setMessage("");
                }}
              >
                <Text
                  style={[
                    styles.tabText,
                    tab === value && styles.activeTabText,
                  ]}
                >
                  {labels[value]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.panel}>
            {tab === "account" ? (
              <AccountSettings
                busy={busy}
                currentPassword={currentPassword}
                newPassword={newPassword}
                onCurrentPasswordChange={setCurrentPassword}
                onLogout={() => leaveAuthenticatedApp(session.logout)}
                onNewPasswordChange={setNewPassword}
                onSave={savePassword}
                offline={session.phase === "offline"}
              />
            ) : tab === "playback" ? (
              <PlaybackSettings
                busy={busy}
                onSave={saveQuality}
                quality={quality}
              />
            ) : tab === "server" ? (
              <ServerSettings
                busy={busy}
                offline={session.phase === "offline"}
                libraryName={session.libraryName}
                onChange={() => leaveAuthenticatedApp(session.changeServer)}
                onRetry={session.retry}
                origin={session.origin}
              />
            ) : tab === "library" ? (
              <LibrarySettings
                busy={busy}
                onIndex={indexFolder}
                onPathChange={setLibraryPath}
                onRefresh={refreshLibrary}
                path={libraryPath}
              />
            ) : (
              <UserSettings
                admin={newUserAdmin}
                busy={busy}
                onAdminChange={setNewUserAdmin}
                onCreate={createUser}
                onPasswordChange={setNewUserPassword}
                onUsernameChange={setNewUsername}
                password={newUserPassword}
                username={newUsername}
              />
            )}
            {message ? (
              <Text accessibilityLiveRegion="polite" style={styles.message}>
                {message}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function AccountSettings({
  busy,
  currentPassword,
  newPassword,
  onCurrentPasswordChange,
  onLogout,
  onNewPasswordChange,
  onSave,
  offline,
}: {
  busy: boolean;
  currentPassword: string;
  newPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  onLogout: () => Promise<void>;
  onNewPasswordChange: (value: string) => void;
  onSave: () => Promise<void>;
  offline: boolean;
}) {
  return (
    <>
      <Text style={styles.heading}>Change password</Text>
      {offline ? (
        <Text style={styles.offlineNote}>
          Reconnect to change account settings.
        </Text>
      ) : null}
      <TextInput
        accessibilityLabel="Current password"
        secureTextEntry
        placeholder="Current password"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={currentPassword}
        editable={!busy && !offline}
        onChangeText={onCurrentPasswordChange}
      />
      <TextInput
        accessibilityLabel="New password"
        secureTextEntry
        placeholder="New password"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={newPassword}
        editable={!busy && !offline}
        onChangeText={onNewPasswordChange}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || offline || !currentPassword || newPassword.length < 8}
        style={[
          styles.primary,
          (busy || offline || !currentPassword || newPassword.length < 8) &&
            styles.disabled,
        ]}
        onPress={() => void onSave()}
      >
        <Text style={styles.primaryText}>Update password</Text>
      </Pressable>
      <View style={styles.divider} />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[styles.action, busy && styles.disabled]}
        onPress={() => void onLogout()}
      >
        <LogOut color="white" size={21} />
        <Text style={styles.actionText}>Log out</Text>
      </Pressable>
    </>
  );
}

const qualityOptions = [
  [96, "Low · 96 kbps"],
  [128, "Normal · 128 kbps"],
  [256, "High · 256 kbps"],
  [0, "Original quality"],
] as const;

function PlaybackSettings({
  busy,
  onSave,
  quality,
}: {
  busy: boolean;
  onSave: (bitrate: number) => Promise<void>;
  quality: number;
}) {
  return (
    <>
      <Text style={styles.heading}>Audio quality</Text>
      {qualityOptions.map(([bitrate, label]) => (
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: quality === bitrate }}
          disabled={busy}
          key={bitrate}
          style={[
            styles.quality,
            quality === bitrate && styles.selected,
            busy && styles.disabled,
          ]}
          onPress={() => void onSave(bitrate)}
        >
          <Text style={styles.actionText}>
            {quality === bitrate ? "✓  " : ""}
            {label}
          </Text>
        </Pressable>
      ))}
    </>
  );
}

function ServerSettings({
  busy,
  offline,
  libraryName,
  onChange,
  onRetry,
  origin,
}: {
  busy: boolean;
  offline: boolean;
  libraryName: string | null;
  onChange: () => Promise<void>;
  onRetry: () => Promise<void>;
  origin: string | null;
}) {
  return (
    <>
      <View style={styles.card}>
        <View style={styles.icon}>
          <Radio color="white" size={21} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>{libraryName}</Text>
          <Text numberOfLines={1} style={styles.value}>
            {origin}
          </Text>
        </View>
      </View>
      {offline ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={[styles.primary, busy && styles.disabled]}
          onPress={() => void onRetry()}
        >
          <Text style={styles.primaryText}>Reconnect</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[styles.action, busy && styles.disabled]}
        onPress={() => void onChange()}
      >
        <Server color="white" size={21} />
        <Text style={styles.actionText}>Change server</Text>
      </Pressable>
    </>
  );
}

function LibrarySettings({
  busy,
  onIndex,
  onPathChange,
  onRefresh,
  path,
}: {
  busy: boolean;
  onIndex: () => Promise<void>;
  onPathChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  path: string;
}) {
  return (
    <>
      <Text style={styles.heading}>Library</Text>
      <TextInput
        accessibilityLabel="Music folder path"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Music folder path"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={path}
        editable={!busy}
        onChangeText={onPathChange}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || !path.trim()}
        style={[styles.primary, (busy || !path.trim()) && styles.disabled]}
        onPress={() => void onIndex()}
      >
        <Text style={styles.primaryText}>Index folder</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[styles.action, busy && styles.disabled]}
        onPress={() => void onRefresh()}
      >
        <Radio color="white" size={21} />
        <Text style={styles.actionText}>Refresh current library</Text>
      </Pressable>
    </>
  );
}

function UserSettings({
  admin,
  busy,
  onAdminChange,
  onCreate,
  onPasswordChange,
  onUsernameChange,
  password,
  username,
}: {
  admin: boolean;
  busy: boolean;
  onAdminChange: (value: boolean) => void;
  onCreate: () => Promise<void>;
  onPasswordChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  password: string;
  username: string;
}) {
  return (
    <>
      <Text style={styles.heading}>Create user</Text>
      <TextInput
        accessibilityLabel="Username"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Username"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={username}
        editable={!busy}
        onChangeText={onUsernameChange}
      />
      <TextInput
        accessibilityLabel="Password"
        secureTextEntry
        placeholder="Password · 8 characters minimum"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={password}
        editable={!busy}
        onChangeText={onPasswordChange}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: admin }}
        disabled={busy}
        style={[styles.adminToggle, busy && styles.disabled]}
        onPress={() => onAdminChange(!admin)}
      >
        <View style={[styles.checkbox, admin && styles.checked]}>
          {admin ? <Text style={styles.check}>✓</Text> : null}
        </View>
        <Text style={styles.actionText}>Administrator</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || username.trim().length < 2 || password.length < 8}
        style={[
          styles.primary,
          (busy || username.trim().length < 2 || password.length < 8) &&
            styles.disabled,
        ]}
        onPress={() => void onCreate()}
      >
        <Text style={styles.primaryText}>Create user</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  tabs: {
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: palette.border,
  },
  tab: { height: 44, paddingHorizontal: 14, justifyContent: "center" },
  activeTab: { borderBottomWidth: 2, borderColor: "white" },
  tabText: { color: palette.muted, fontSize: 14, fontWeight: "600" },
  activeTabText: { color: "white" },
  panel: { padding: 20, gap: 12 },
  heading: { color: "white", fontSize: 19, fontWeight: "800", marginBottom: 5 },
  offlineNote: { color: palette.secondary, lineHeight: 20 },
  input: {
    height: 50,
    borderRadius: 10,
    backgroundColor: palette.elevatedStrong,
    borderWidth: 1,
    borderColor: palette.border,
    color: "white",
    paddingHorizontal: 15,
  },
  primary: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "black", fontWeight: "800" },
  disabled: { opacity: 0.45 },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 12 },
  action: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  actionText: { color: "white", fontSize: 15, fontWeight: "600" },
  quality: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  selected: { borderColor: "white", backgroundColor: "#19191d" },
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: palette.elevatedStrong,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#29292e",
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: "white", fontWeight: "800" },
  value: { color: palette.secondary, fontSize: 13, marginTop: 4 },
  body: { color: palette.secondary, lineHeight: 21 },
  message: { color: palette.secondary, marginTop: 8 },
  adminToggle: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: "white", borderColor: "white" },
  check: { color: "black", fontWeight: "900" },
});
