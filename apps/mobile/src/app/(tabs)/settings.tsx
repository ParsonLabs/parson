import {
  changePassword,
  indexLibrary,
  refreshCurrentLibrary,
  register,
  setBitrate,
} from "@parson/music-sdk";
import { LogOut, Radio, Server } from "lucide-react-native";
import { useState } from "react";
import {
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
  const session = useSession();
  const admin = session.claims?.role === "admin";
  const tabs: Tab[] = admin
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
  const savePassword = async () => {
    setMessage("Updating password…");
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated.");
    } catch {
      setMessage("Could not update password.");
    }
  };
  const saveQuality = async (bitrate: number) => {
    setQuality(bitrate);
    setMessage("Updating quality…");
    try {
      await setBitrate(bitrate);
      session.updateBitrate(bitrate);
      setMessage("Quality updated.");
    } catch {
      setMessage("Could not update quality.");
    }
  };
  const indexFolder = async () => {
    if (!libraryPath.trim()) return;
    setMessage("Indexing…");
    try {
      const result = await indexLibrary(libraryPath.trim());
      setMessage(
        `Library updated · ${result.report.indexed_files} songs indexed.`,
      );
    } catch {
      setMessage("Could not index this folder.");
    }
  };
  const refreshLibrary = async () => {
    setMessage("Refreshing…");
    try {
      const result = await refreshCurrentLibrary();
      setMessage(
        `Refreshed ${result.refreshed.length} library folder${result.refreshed.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setMessage("Current library could not be refreshed.");
    }
  };
  const createUser = async () => {
    if (newUsername.trim().length < 2 || newUserPassword.length < 8) return;
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
                key={value}
                style={[styles.tab, tab === value && styles.activeTab]}
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
                currentPassword={currentPassword}
                newPassword={newPassword}
                onCurrentPasswordChange={setCurrentPassword}
                onLogout={session.logout}
                onNewPasswordChange={setNewPassword}
                onSave={savePassword}
              />
            ) : tab === "playback" ? (
              <PlaybackSettings onSave={saveQuality} quality={quality} />
            ) : tab === "server" ? (
              <ServerSettings
                offline={session.phase === "offline"}
                libraryName={session.libraryName}
                onChange={session.changeServer}
                onRetry={session.retry}
                origin={session.origin}
              />
            ) : tab === "library" ? (
              <LibrarySettings
                onIndex={indexFolder}
                onPathChange={setLibraryPath}
                onRefresh={refreshLibrary}
                path={libraryPath}
              />
            ) : (
              <UserSettings
                admin={newUserAdmin}
                onAdminChange={setNewUserAdmin}
                onCreate={createUser}
                onPasswordChange={setNewUserPassword}
                onUsernameChange={setNewUsername}
                password={newUserPassword}
                username={newUsername}
              />
            )}
            {message ? <Text style={styles.message}>{message}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function AccountSettings({
  currentPassword,
  newPassword,
  onCurrentPasswordChange,
  onLogout,
  onNewPasswordChange,
  onSave,
}: {
  currentPassword: string;
  newPassword: string;
  onCurrentPasswordChange: (value: string) => void;
  onLogout: () => Promise<void>;
  onNewPasswordChange: (value: string) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <>
      <Text style={styles.heading}>Change password</Text>
      <TextInput
        secureTextEntry
        placeholder="Current password"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={currentPassword}
        onChangeText={onCurrentPasswordChange}
      />
      <TextInput
        secureTextEntry
        placeholder="New password"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={newPassword}
        onChangeText={onNewPasswordChange}
      />
      <Pressable style={styles.primary} onPress={() => void onSave()}>
        <Text style={styles.primaryText}>Update password</Text>
      </Pressable>
      <View style={styles.divider} />
      <Pressable style={styles.action} onPress={() => void onLogout()}>
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
  onSave,
  quality,
}: {
  onSave: (bitrate: number) => Promise<void>;
  quality: number;
}) {
  return (
    <>
      <Text style={styles.heading}>Audio quality</Text>
      {qualityOptions.map(([bitrate, label]) => (
        <Pressable
          key={bitrate}
          style={[styles.quality, quality === bitrate && styles.selected]}
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
  offline,
  libraryName,
  onChange,
  onRetry,
  origin,
}: {
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
        <Pressable style={styles.primary} onPress={() => void onRetry()}>
          <Text style={styles.primaryText}>Reconnect</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.action} onPress={() => void onChange()}>
        <Server color="white" size={21} />
        <Text style={styles.actionText}>Change server</Text>
      </Pressable>
    </>
  );
}

function LibrarySettings({
  onIndex,
  onPathChange,
  onRefresh,
  path,
}: {
  onIndex: () => Promise<void>;
  onPathChange: (value: string) => void;
  onRefresh: () => Promise<void>;
  path: string;
}) {
  return (
    <>
      <Text style={styles.heading}>Library</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Music folder path"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={path}
        onChangeText={onPathChange}
      />
      <Pressable style={styles.primary} onPress={() => void onIndex()}>
        <Text style={styles.primaryText}>Index folder</Text>
      </Pressable>
      <Pressable style={styles.action} onPress={() => void onRefresh()}>
        <Radio color="white" size={21} />
        <Text style={styles.actionText}>Refresh current library</Text>
      </Pressable>
    </>
  );
}

function UserSettings({
  admin,
  onAdminChange,
  onCreate,
  onPasswordChange,
  onUsernameChange,
  password,
  username,
}: {
  admin: boolean;
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
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Username"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={username}
        onChangeText={onUsernameChange}
      />
      <TextInput
        secureTextEntry
        placeholder="Password · 8 characters minimum"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={password}
        onChangeText={onPasswordChange}
      />
      <Pressable
        style={styles.adminToggle}
        onPress={() => onAdminChange(!admin)}
      >
        <View style={[styles.checkbox, admin && styles.checked]}>
          {admin ? <Text style={styles.check}>✓</Text> : null}
        </View>
        <Text style={styles.actionText}>Administrator</Text>
      </Pressable>
      <Pressable style={styles.primary} onPress={() => void onCreate()}>
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
