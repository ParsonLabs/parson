import { Redirect } from "expo-router";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";

import { palette } from "@/constants/colors";
import { useLibraryDiscovery } from "@/hooks/use-library-discovery";
import { useSession } from "@/providers/session-provider";

export default function EntryScreen() {
  const session = useSession();
  useLibraryDiscovery();
  const [server, setServer] = useState(session.origin ?? "");
  const [serverEdited, setServerEdited] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [libraryPath, setLibraryPath] = useState("");
  const serverValue = serverEdited ? server : (session.origin ?? server);
  if (session.phase === "ready") return <Redirect href="/(tabs)" />;
  if (session.phase === "offline") return <Redirect href="/(tabs)/library" />;

  const busy =
    session.phase === "loading" ||
    session.phase === "connecting" ||
    session.phase === "indexing";
  const heading =
    session.phase === "login"
      ? "Welcome back"
      : session.phase === "indexing"
        ? "Preparing your library"
        : session.phase === "setup"
          ? session.setupStatus?.account_setup_required
            ? "Create your account"
            : "Choose your music folder"
          : "Finding your library";
  const detail =
    session.phase === "indexing"
      ? "Parson is indexing your music. This screen will update automatically."
      : session.phase === "setup"
        ? (session.setupStatus?.message ??
          "Finish setting up this Parson library.")
        : session.phase === "login"
          ? (session.libraryName ?? "Sign in to your Parson library")
          : "";

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.page}
    >
      <View style={styles.content}>
        <Image
          source={require("@/assets/images/parson-icon.png")}
          style={styles.logo}
        />
        <Text style={styles.heading}>{heading}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
        {busy && (
          <ActivityIndicator
            color="white"
            size="small"
            style={styles.spinner}
          />
        )}
        {session.phase === "setup" ? (
          <View style={styles.form}>
            {session.setupStatus?.account_setup_required ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Admin username"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                />
                <TextInput
                  placeholder="Password"
                  placeholderTextColor={palette.muted}
                  secureTextEntry
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                />
                {session.setupStatus.setup_code_required ? (
                  <TextInput
                    autoCapitalize="characters"
                    placeholder="Setup code"
                    placeholderTextColor={palette.muted}
                    style={styles.input}
                    value={setupCode}
                    onChangeText={setSetupCode}
                  />
                ) : null}
                <Pressable
                  style={styles.primary}
                  onPress={() =>
                    void session.setupAccount(username, password, setupCode)
                  }
                >
                  <Text style={styles.primaryText}>Create account</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={
                    session.setupStatus?.suggested_library_path ||
                    "Music folder path"
                  }
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={libraryPath}
                  onChangeText={setLibraryPath}
                />
                <Pressable
                  style={styles.primary}
                  onPress={() =>
                    void session.setupLibrary(
                      libraryPath ||
                        session.setupStatus?.suggested_library_path ||
                        "",
                    )
                  }
                >
                  <Text style={styles.primaryText}>Index library</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : session.phase === "login" ? (
          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Username"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={username}
              onChangeText={setUsername}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={palette.muted}
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void session.login(username, password)}
            />
            <Pressable
              style={styles.primary}
              onPress={() => void session.login(username, password)}
            >
              <Text style={styles.primaryText}>Sign in</Text>
            </Pressable>
            <Pressable onPress={() => void session.changeServer()}>
              <Text style={styles.link}>Choose another library</Text>
            </Pressable>
          </View>
        ) : session.phase === "discovering" ||
          session.phase === "connecting" ||
          session.phase === "loading" ? (
          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="192.168.1.10:1993"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={serverValue}
              onChangeText={(value) => {
                setServerEdited(true);
                setServer(value);
              }}
              onSubmitEditing={() => void session.connect(serverValue)}
            />
            <Pressable
              disabled={busy || !serverValue.trim()}
              style={[styles.primary, busy && styles.disabledPrimary]}
              onPress={() => void session.connect(serverValue)}
            >
              <Text style={styles.primaryText}>
                {session.phase === "connecting" ? "Connecting…" : "Connect"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {session.error &&
        (session.phase === "login" ||
          session.phase === "setup" ||
          session.phase === "discovering") ? (
          <Text style={styles.error}>
            Something went wrong. Please try again.
          </Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "black",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  content: {
    alignItems: "center",
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
  },
  logo: { width: 72, height: 72, borderRadius: 18, marginBottom: 26 },
  heading: {
    color: "white",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  detail: {
    color: palette.secondary,
    textAlign: "center",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 330,
  },
  spinner: { marginTop: 25 },
  form: { width: "100%", gap: 12, marginTop: 28 },
  input: {
    height: 52,
    borderRadius: 12,
    backgroundColor: palette.elevatedStrong,
    borderWidth: 1,
    borderColor: palette.border,
    color: "white",
    paddingHorizontal: 16,
    fontSize: 16,
  },
  primary: {
    height: 52,
    backgroundColor: "white",
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "black", fontSize: 16, fontWeight: "800" },
  disabledPrimary: { opacity: 0.62 },
  link: { color: "white", textAlign: "center", fontWeight: "700", padding: 12 },
  error: { color: "#fb7185", textAlign: "center", marginTop: 16 },
});
