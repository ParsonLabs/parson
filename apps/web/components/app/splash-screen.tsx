"use client";

import { useSession } from "@/features/account/session-provider";
import {
  getMediaToken,
  getSetupStatus,
  refreshMediaToken,
  refreshToken,
} from "@parson/music-sdk";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export default function AppBootstrap({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const {
    librarySetupPending,
    session: activeSession,
    setSession,
  } = useSession();
  const initializedAttempt = useRef<number | null>(null);

  useEffect(() => {
    if (pathname.startsWith("/setup") || pathname === "/connect") {
      setLoading(false);
      return;
    }
    // Bootstrap once per explicit attempt.
    if (initializedAttempt.current === attempt) return;
    initializedAttempt.current = attempt;

    async function initialize() {
      setBootstrapFailed(false);
      setLoading(!librarySetupPending);
      try {
        const setup = await getSetupStatus();
        if (setup.setup_required && !librarySetupPending) {
          router.replace("/setup");
          return;
        }
        let session = setup.session ?? null;
        if (!session) {
          const refreshed = await refreshToken();
          if (refreshed.transient)
            throw new Error(refreshed.message || "Session unavailable");
          session = refreshed.status ? (refreshed.claims ?? null) : null;
        }
        if (session) {
          const media = await refreshMediaToken();
          if (!media.status || !media.media_token) {
            throw new Error("Media authorization unavailable");
          }
        }
        setSession(session);
        if (session && pathname === "/login") {
          router.replace("/");
        } else if (!session && pathname !== "/login") {
          router.replace("/login");
        }
      } catch {
        setBootstrapFailed(true);
      } finally {
        setLoading(false);
      }
    }

    void initialize();
  }, [attempt, librarySetupPending, pathname, router, setSession]);

  useEffect(() => {
    if (!activeSession) return;
    const refresh = () => {
      void refreshMediaToken().catch(() => {});
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && !getMediaToken()) refresh();
    };
    const interval = window.setInterval(refresh, 4 * 60 * 60 * 1000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeSession]);

  useEffect(() => {
    const retryWhenOnline = () => setAttempt((value) => value + 1);
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, []);

  useEffect(() => {
    // Remove caches and workers left by pre-v1 clients.
    async function retireLegacyCaches() {
      const controlledByLegacyWorker = Boolean(
        "serviceWorker" in navigator && navigator.serviceWorker.controller,
      );
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) => registration.unregister()),
        );
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      // Reload once to release the retired worker from this document.
      if (
        controlledByLegacyWorker &&
        !sessionStorage.getItem("parson:legacy-worker-retired")
      ) {
        sessionStorage.setItem("parson:legacy-worker-retired", "1");
        window.location.reload();
      }
    }

    void retireLegacyCaches();
  }, []);

  if (bootstrapFailed) {
    return (
      <main className="fixed inset-0 z-[9999] flex items-center justify-center bg-black px-6 text-white">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Can’t connect to the server</h1>
          <button
            className="mt-5 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            onClick={() => setAttempt((value) => value + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      {loading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black">
          <div className="h-2 w-2 animate-pulse rounded-full bg-white/70" />
        </div>
      )}
      {children}
    </>
  );
}
