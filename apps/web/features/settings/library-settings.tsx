"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasDesktopBridge, selectMusicFolder } from "@/lib/desktop/bridge";
import {
  getLibraryCatalog,
  getLibraryReadiness,
  getLibraryRoots,
  indexLibrary,
  refreshCurrentLibrary,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { Folder, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function LibrarySettings() {
  const [desktop, setDesktop] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState<"add" | "refresh" | null>(null);
  const roots = useQuery({
    queryKey: ["library-roots"],
    queryFn: getLibraryRoots,
  });
  const readiness = useQuery({
    queryKey: ["library-readiness", "settings"],
    queryFn: getLibraryReadiness,
  });
  const catalog = useQuery({
    queryKey: ["library-catalog", "settings-count"],
    queryFn: () => getLibraryCatalog(0, 1),
  });

  useEffect(() => setDesktop(hasDesktopBridge()), []);

  async function addLibrary(nextPath: string) {
    const selected = nextPath.trim();
    if (!selected || busy) return;
    setBusy("add");
    try {
      await indexLibrary(selected);
      setPath("");
      setAddOpen(false);
      await Promise.all([
        roots.refetch(),
        readiness.refetch(),
        catalog.refetch(),
      ]);
      toast.success("Music folder added.");
    } catch {
      toast("Could not use that folder. Check the path and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function changeFolder() {
    if (desktop) {
      const selected = await selectMusicFolder();
      if (selected) await addLibrary(selected);
      return;
    }
    setAddOpen(true);
  }

  async function refresh() {
    if (busy) return;
    setBusy("refresh");
    try {
      await refreshCurrentLibrary();
      await Promise.all([readiness.refetch(), catalog.refetch()]);
      toast.success("Library checked for changes.");
    } catch {
      toast("Could not check the library right now.");
    } finally {
      setBusy(null);
    }
  }

  const paths = roots.data ?? [];
  const status = !readiness.data
    ? "Loading…"
    : readiness.data.state === "ready"
      ? "Ready"
      : "Needs attention";

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {paths.length > 1 ? "Music folders" : "Music folder"}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              {desktop
                ? "Parson watches this folder for your music."
                : "Folders mounted and available to Parson."}
            </p>
          </div>
          <Button onClick={() => void changeFolder()} variant="outline">
            {paths.length
              ? desktop
                ? "Change folder"
                : "Add another library"
              : "Add library"}
          </Button>
        </div>
        <div className="mt-5 overflow-hidden rounded-lg border border-white/10">
          {roots.isLoading ? (
            <div className="flex h-20 items-center justify-center text-zinc-500">
              <Loader2
                className="h-4 w-4 animate-spin"
                aria-label="Loading music folders"
              />
            </div>
          ) : paths.length ? (
            paths.map((root) => (
              <div
                className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-4 last:border-0"
                key={root.path}
              >
                <Folder className="h-5 w-5 shrink-0 text-zinc-500" />
                <p
                  className="min-w-0 flex-1 truncate text-sm text-zinc-200"
                  title={root.path}
                >
                  {root.path}
                </p>
              </div>
            ))
          ) : (
            <p className="px-4 py-5 text-sm text-zinc-500">
              No music folder is configured.
            </p>
          )}
        </div>
      </section>

      <section className="border-t border-white/[0.08] pt-7">
        <h2 className="text-base font-semibold text-white">Library status</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Status</dt>
            <dd className="mt-1 text-zinc-200">{status}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Tracks</dt>
            <dd className="mt-1 text-zinc-200">
              {catalog.data ? catalog.data.totalSongs.toLocaleString() : "—"}
            </dd>
          </div>
        </dl>
        <Button
          className="mt-6"
          disabled={Boolean(busy) || !paths.length}
          onClick={() => void refresh()}
        >
          {busy === "refresh" && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy === "refresh" ? "Checking…" : "Check for changes"}
        </Button>
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a music library</DialogTitle>
            <DialogDescription>
              Enter a folder path mounted inside the Parson container, such as
              /music.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm text-zinc-300">
            Mounted folder path
            <Input
              autoFocus
              onChange={(event) => setPath(event.target.value)}
              placeholder="/music"
              value={path}
            />
          </label>
          <DialogFooter className="gap-2">
            <Button onClick={() => setAddOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={!path.trim() || Boolean(busy)}
              onClick={() => void addLibrary(path)}
            >
              {busy === "add" ? "Adding…" : "Use this folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
