"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/features/account/session-provider";
import FileBrowser from "@/features/setup/file-browser";
import { setupScreenFor, type SetupScreen } from "@/features/setup/setup-state";
import {
  getSetupStatus,
  getLibrarySuggestions,
  login,
  refreshToken,
  register,
  type SetupStatus,
  type LibrarySuggestion,
} from "@parson/music-sdk";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

type View = SetupScreen | "loading" | "error";

export default function SetupFlow() {
  const router = useRouter();
  const { setSession } = useSession();
  const [view, setView] = useState<View>("loading");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [suggestions, setSuggestions] = useState<LibrarySuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null,
  );

  const applyStatus = useCallback(
    (nextStatus: SetupStatus, hasAdminSession: boolean) => {
      const nextView = setupScreenFor(nextStatus, hasAdminSession);
      setStatus(nextStatus);
      if (nextView === "sign-in") {
        router.replace(`/login?next=${encodeURIComponent("/setup")}`);
      } else if (nextView === "done") {
        router.replace(hasAdminSession ? "/" : "/login");
      } else {
        setView(nextView);
      }
    },
    [router],
  );

  const loadSetup = useCallback(async () => {
    setView((current) => (current === "indexing" ? current : "loading"));
    try {
      const nextStatus = await getSetupStatus();
      if (!nextStatus.server_ready) throw new Error("Server is not ready");

      let activeSession = nextStatus.session ?? null;
      if (
        !nextStatus.account_setup_required &&
        !nextStatus.authenticated_admin &&
        !activeSession
      ) {
        const refreshed = await refreshToken();
        if (refreshed.transient)
          throw new Error(refreshed.message || "Session unavailable");
        activeSession = refreshed.status ? (refreshed.claims ?? null) : null;
      }
      setSession(activeSession);
      applyStatus(nextStatus, activeSession?.role === "admin");
    } catch {
      setView("error");
    }
  }, [applyStatus, setSession]);

  useEffect(() => {
    void loadSetup();
  }, [attempt, loadSetup]);

  useEffect(() => {
    if (view !== "indexing") return;
    const retry = window.setTimeout(
      () => setAttempt((value) => value + 1),
      2_500,
    );
    return () => window.clearTimeout(retry);
  }, [view, attempt]);

  useEffect(() => {
    if (view !== "library") return;
    let active = true;
    setLoadingSuggestions(true);
    void getLibrarySuggestions()
      .then((items) => {
        if (active) setSuggestions(items);
      })
      .catch(() => {
        if (active) setSuggestions([]);
      })
      .finally(() => {
        if (active) setLoadingSuggestions(false);
      });
    return () => {
      active = false;
    };
  }, [view]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingAccount) return;
    setCreatingAccount(true);
    const credentials = {
      username: username.trim(),
      password,
      role: "admin",
      setup_code: status?.setup_code_required ? setupCode.trim() : undefined,
    };
    try {
      const created = await register(credentials);
      if (!created.status) {
        toast(created.message || "That account could not be created.");
        return;
      }
      const signedIn = await login({
        username: credentials.username,
        password,
      });
      if (!signedIn.status) {
        toast("Account created. Sign in to continue.");
        router.replace("/login?next=/setup");
        return;
      }
      const nextSession = signedIn.claims;
      if (nextSession?.role !== "admin") {
        toast("Sign in to continue.");
        router.replace("/login?next=/setup");
        return;
      }
      setSession(nextSession);
      applyStatus(await getSetupStatus(), true);
    } catch {
      toast("The server did not respond. Try again.");
    } finally {
      setCreatingAccount(false);
    }
  }

  if (view === "loading") return <SetupProgress label="Getting things ready" />;
  if (view === "indexing") return <SetupProgress label="Adding your music" />;
  if (view === "error") {
    return (
      <SetupFrame title="The server isn’t ready yet">
        <p className="text-sm text-zinc-400">
          Check that Parson is running, then try again.
        </p>
        <Button
          className="mt-6 bg-white text-black hover:bg-zinc-200"
          onClick={() => {
            setView("loading");
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </SetupFrame>
    );
  }

  if (view === "account") {
    return (
      <SetupFrame title="Welcome to Parson">
        <form className="mt-8 grid gap-4" onSubmit={createAccount}>
          <Input
            aria-label="Username"
            autoComplete="username"
            autoFocus
            maxLength={64}
            minLength={1}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
            required
            value={username}
          />
          <Input
            aria-label="Password"
            autoComplete="new-password"
            maxLength={256}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
          {status?.setup_code_required && (
            <Input
              aria-label="Server setup code"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              maxLength={12}
              minLength={12}
              onChange={(event) =>
                setSetupCode(event.target.value.toUpperCase())
              }
              placeholder="Server setup code"
              required
              value={setupCode}
            />
          )}
          <Button
            className="mt-2 bg-white text-black hover:bg-zinc-200"
            disabled={
              creatingAccount ||
              !username.trim() ||
              password.length < 8 ||
              (status?.setup_code_required && setupCode.trim().length !== 12)
            }
            type="submit"
          >
            {creatingAccount ? "Creating account…" : "Create account"}
          </Button>
          <Link
            className="text-center text-sm text-zinc-500 hover:text-white"
            href="/connect"
          >
            Connect to another server
          </Link>
        </form>
      </SetupFrame>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[760px] px-5 pb-16 pt-24 sm:px-7">
      <h1 className="mt-3 text-3xl font-semibold">Where is your music?</h1>
      {(loadingSuggestions || suggestions.length > 0) && (
        <section className="mb-6 mt-8 overflow-hidden rounded-lg border border-white/10">
          <div className="border-b border-white/10 px-5 py-4">
            <h2 className="text-sm font-semibold text-white">Suggested</h2>
          </div>
          {loadingSuggestions ? (
            <div className="flex items-center gap-2 px-5 py-4 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking likely folders…
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.path}
                  type="button"
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.05]"
                  onClick={() => setSelectedDirectory(suggestion.path)}
                  title={suggestion.path}
                >
                  <Folder className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">
                      {suggestion.label}
                    </span>
                    <span className="block truncate text-xs text-zinc-500">
                      {suggestion.path}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {suggestion.count_is_limited ? "At least" : "About"}{" "}
                    {suggestion.track_count.toLocaleString()} tracks
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      <h2
        className={`mb-3 text-sm font-semibold text-zinc-200 ${
          loadingSuggestions || suggestions.length > 0 ? "" : "mt-8"
        }`}
      >
        Choose another folder
      </h2>
      <FileBrowser
        actionLabel="Use this folder"
        initialDirectory={
          selectedDirectory || status?.suggested_library_path || "/"
        }
        onIndexed={async () => {
          router.replace("/");
          router.refresh();
        }}
        setupMode
      />
    </main>
  );
}

function SetupProgress({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-black text-white">
      <div className="flex items-center gap-3 text-sm text-zinc-300">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        {label}
      </div>
    </main>
  );
}

function SetupFrame({
  children,
  description,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  description?: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-20">
      <section className="w-full max-w-sm">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-3 text-sm text-zinc-400">{description}</p>
        )}
        {children}
      </section>
    </main>
  );
}
