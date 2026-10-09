"use client";

import { Input } from "@/components/ui/input";
import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  Suspense,
} from "react";
import AppSidebar from "@/components/layout/app-sidebar";
import RouteScrollRestoration from "@/components/layout/route-scroll-restoration";
import ParsonBrandMark from "@/components/icons/parson-brand-mark";
import { DesktopWindowControls } from "@/components/layout/desktop-window-controls";
import {
  clearCachedAlbumInfos,
  clearCachedArtistInfos,
  clearCachedSongInfos,
  getLibraryReadiness,
} from "@parson/music-sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  invalidateCatalogRevisionQueries,
  libraryReadinessPollInterval,
  libraryReadinessShouldRefetch,
} from "@/features/library/library-readiness-state";

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const mainRef = useRef<HTMLElement>(null);
  const readiness = useQuery({
    queryKey: ["library", "readiness"],
    queryFn: getLibraryReadiness,
    refetchInterval: (query) => libraryReadinessPollInterval(query.state.data),
    refetchOnMount: (query) => libraryReadinessShouldRefetch(query.state.data),
    refetchOnReconnect: (query) =>
      libraryReadinessShouldRefetch(query.state.data),
    refetchOnWindowFocus: (query) =>
      libraryReadinessShouldRefetch(query.state.data),
  });

  useEffect(() => {
    if (!readiness.data) {
      return;
    }
    clearCachedAlbumInfos();
    clearCachedArtistInfos();
    clearCachedSongInfos();
    void invalidateCatalogRevisionQueries(queryClient);
  }, [queryClient, readiness.data?.catalog_revision]);

  useEffect(() => {
    const syncQueryFromLocation = () => {
      setQuery(
        pathname === "/search"
          ? (new URLSearchParams(window.location.search).get("q") ?? "")
          : "",
      );
    };
    syncQueryFromLocation();
    window.addEventListener("popstate", syncQueryFromLocation);
    return () => window.removeEventListener("popstate", syncQueryFromLocation);
  }, [pathname]);

  function navigateToSearch() {
    const value = query.trim();
    if (!value) {
      return;
    }
    const href = `/search?q=${encodeURIComponent(value)}`;
    window.dispatchEvent(
      new CustomEvent("parson:search-submitted", { detail: { href } }),
    );
    router.push(href);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigateToSearch();
  }

  function submitSearchFromKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    navigateToSearch();
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <AppSidebar />

      <header className="electron-titlebar-drag fixed left-0 right-0 top-0 z-40 h-14 bg-black px-4 md:left-20 md:px-5">
        <div className="relative flex h-full items-center justify-center gap-3">
          <Link
            className="electron-titlebar-no-drag absolute left-0 flex h-10 w-10 shrink-0 select-none items-center justify-center md:hidden"
            href="/"
            aria-label="Parson home"
            draggable={false}
            onClick={() =>
              window.dispatchEvent(new Event("parson:navigate-home"))
            }
          >
            <ParsonBrandMark className="h-9 w-9" />
          </Link>

          <form
            className="electron-titlebar-no-drag relative mx-12 w-full max-w-130 md:mx-0"
            onSubmit={submitSearch}
          >
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              aria-label="Search music"
              className="h-10 rounded-full border border-zinc-800 bg-black! py-2 pl-11 pr-11 text-sm text-zinc-200 shadow-none placeholder:text-zinc-600 focus:placeholder:text-transparent focus-visible:border-zinc-600 focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={submitSearchFromKeyboard}
              placeholder="What do you want to play?"
              value={query}
            />
            <button
              aria-label="Search"
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-0"
              disabled={!query.trim()}
              type="submit"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <DesktopWindowControls />
        </div>
      </header>

      <main
        ref={mainRef}
        className="app-content-shell app-shell-scroll overflow-x-hidden overflow-y-auto overscroll-contain bg-[#050505]"
      >
        <Suspense fallback={null}>
          <RouteScrollRestoration containerRef={mainRef} />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
