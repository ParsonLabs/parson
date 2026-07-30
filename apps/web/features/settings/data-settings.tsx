"use client";

import { Button } from "@/components/ui/button";
import FailureState from "@/components/app/failure-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  clearPersonalHistory,
  clearParsonCache,
  createPrivateBackup,
  deletePrivateBackup,
  downloadPrivateBackup,
  exportPersonalData,
  exportPublicLibraryIndex,
  getDataStatus,
  resetParson,
  restorePrivateBackup,
} from "@parson/music-sdk";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type BusyAction =
  | "backup"
  | "download"
  | "public"
  | "personal"
  | "history"
  | "restore"
  | "delete"
  | "cache"
  | "reset"
  | null;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export default function DataSettings({ isAdmin }: { isAdmin: boolean }) {
  const restoreInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cacheOpen, setCacheOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const status = useQuery({
    queryKey: ["data-status"],
    queryFn: getDataStatus,
    enabled: isAdmin,
  });
  const latest = status.data?.backups[0];

  async function run(
    action: Exclude<BusyAction, null>,
    work: () => Promise<void>,
  ) {
    if (busy) return;
    setBusy(action);
    try {
      await work();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The operation failed.";
      if (action === "backup") setBackupError(message);
      else {
        const errors: Record<Exclude<BusyAction, null>, string> = {
          backup: "Backup wasn’t created.",
          download: "Backup wasn’t downloaded.",
          public: "Index wasn’t exported.",
          personal: "Your data wasn’t exported.",
          history: "History wasn’t cleared.",
          restore: "Backup wasn’t restored.",
          delete: "Backup wasn’t deleted.",
          cache: "Cache wasn’t cleared.",
          reset: "Reset wasn’t prepared.",
        };
        toast.error(errors[action]);
      }
    } finally {
      setBusy(null);
    }
  }

  async function createAndDownloadBackup() {
    setBackupError(null);
    await run("backup", async () => {
      const backup = await createPrivateBackup();
      await status.refetch();
      const blob = await downloadPrivateBackup(backup.filename);
      downloadBlob(blob, backup.filename);
      toast.success("Private backup created and downloaded.");
    });
  }

  function spinner(action: BusyAction) {
    return busy === action ? <Loader2 className="animate-spin" /> : null;
  }

  return (
    <div className="space-y-9">
      {isAdmin && (
        <>
          <section>
            <h2 className="text-base font-semibold text-white">Backups</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
              Accounts, playlists, history, preferences, profile pictures, and
              artwork. Music files and active sessions are not included.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                disabled={Boolean(busy)}
                onClick={() => void createAndDownloadBackup()}
              >
                {spinner("backup")}
                {busy === "backup" ? "Backing up…" : "Back up now"}
              </Button>
              <button
                className="text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-50"
                disabled={Boolean(busy)}
                onClick={() => restoreInput.current?.click()}
                type="button"
              >
                Restore from backup
              </button>
              <input
                accept=".zst,.tar.zst,application/zstd"
                className="hidden"
                onChange={(event) => {
                  setRestoreFile(event.target.files?.[0] ?? null);
                  event.currentTarget.value = "";
                }}
                ref={restoreInput}
                type="file"
              />
            </div>
            {backupError ? (
              <FailureState
                className="mt-5 max-w-none"
                detail={backupError}
                kind="backup_failed"
                onAction={() => void createAndDownloadBackup()}
              />
            ) : null}
            <div className="mt-5 flex items-center gap-3 rounded-lg border border-white/[0.08] px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">
                  Last successful backup
                </p>
                {latest ? (
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {formatBytes(latest.size_bytes)} ·{" "}
                    {new Date(latest.created_at).toLocaleString()} ·{" "}
                    {latest.tier ?? "manual"}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-zinc-600">
                    No backups yet.
                  </p>
                )}
              </div>
              {latest && (
                <>
                  <Button
                    aria-label="Download latest backup"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("download", async () => {
                        downloadBlob(
                          await downloadPrivateBackup(latest.filename),
                          latest.filename,
                        );
                      })
                    }
                    size="icon"
                    variant="ghost"
                  >
                    {spinner("download") ?? <Download />}
                  </Button>
                  <Button
                    aria-label="Delete latest backup"
                    disabled={Boolean(busy)}
                    onClick={() => setDeleteOpen(true)}
                    size="icon"
                    variant="ghost"
                  >
                    {spinner("delete") ?? <Trash2 />}
                  </Button>
                </>
              )}
            </div>
            {status.data?.restore_pending && (
              <p className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                A validated restore is ready. Restart Parson to apply it.
              </p>
            )}
          </section>

          <section className="border-t border-white/[0.08] pt-8">
            <h2 className="text-base font-semibold text-white">
              Library index
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
              A ZIP with artists, releases, tracks, identifiers, and audio
              details.
            </p>
            <p className="mt-2 max-w-xl text-xs leading-5 text-zinc-600">
              Paths, filenames, folders, accounts, server identity, playlists,
              favorites, and activity history are always omitted.
            </p>
            <Button
              className="mt-5"
              disabled={Boolean(busy)}
              onClick={() =>
                void run("public", async () => {
                  const blob = await exportPublicLibraryIndex();
                  downloadBlob(
                    blob,
                    `parson-library-index-${new Date().toISOString().slice(0, 10)}.zip`,
                  );
                  toast.success("Library index exported.");
                })
              }
            >
              {spinner("public")}
              {busy === "public" ? "Building index…" : "Export index"}
            </Button>
          </section>
        </>
      )}

      <section
        className={isAdmin ? "border-t border-white/[0.08] pt-8" : undefined}
      >
        <h2 className="text-base font-semibold text-white">Your data</h2>
        <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
          Download a readable copy of your profile, listening history,
          favorites, searches, and playlists, or erase private activity history.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            disabled={Boolean(busy)}
            onClick={() =>
              void run("personal", async () => {
                downloadBlob(
                  await exportPersonalData(),
                  `parson-my-data-${new Date().toISOString().slice(0, 10)}.json`,
                );
              })
            }
          >
            {spinner("personal") ?? <Download />}
            Export playlists and user data
          </Button>
          <Button
            disabled={Boolean(busy)}
            onClick={() => setClearOpen(true)}
            variant="outline"
          >
            <Trash2 />
            Clear activity history
          </Button>
        </div>
      </section>

      {isAdmin && (
        <section className="border-t border-white/[0.08] pt-8">
          <h2 className="text-base font-semibold text-white">Cache</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
            Remove downloaded artwork, lyrics, and temporary library data.
            Parson rebuilds them when needed. Accounts, playlists, history, and
            music are not changed.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <Button
              disabled={Boolean(busy)}
              onClick={() => setCacheOpen(true)}
              variant="outline"
            >
              Clear cache
            </Button>
            <span className="text-xs text-zinc-600">
              {formatBytes(status.data?.cache_bytes ?? 0)}
            </span>
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="border-t border-red-500/20 pt-8">
          <h2 className="text-base font-semibold text-red-300">Reset Parson</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-zinc-500">
            Remove accounts, settings, playlists, history, and the library
            index. Music files are not deleted. A safety backup is kept.
          </p>
          <Button
            className="mt-5"
            disabled={Boolean(busy)}
            onClick={() => setResetOpen(true)}
            variant="destructive"
          >
            Reset Parson
          </Button>
          {status.data?.reset_pending && (
            <p className="mt-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Reset is ready. Restart Parson to finish.
            </p>
          )}
        </section>
      )}

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear your activity history?</DialogTitle>
            <DialogDescription>
              This permanently removes listening, playback, search, lyrics, and
              recommendation activity. Favorites and playlists are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setClearOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={busy === "history"}
              onClick={() =>
                void run("history", async () => {
                  const result = await clearPersonalHistory();
                  setClearOpen(false);
                  toast.success(
                    result.deleted
                      ? `Cleared ${result.deleted.toLocaleString()} activity records.`
                      : "Your activity history is already clear.",
                  );
                })
              }
              variant="destructive"
            >
              {spinner("history")}
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete the latest backup?</DialogTitle>
            <DialogDescription>
              This permanently removes {latest?.filename ?? "this backup"} from
              the server. A downloaded copy is not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setDeleteOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={busy === "delete" || !latest}
              onClick={() =>
                void run("delete", async () => {
                  if (!latest) return;
                  await deletePrivateBackup(latest.filename);
                  setDeleteOpen(false);
                  await status.refetch();
                  toast.success("Backup deleted.");
                })
              }
              variant="destructive"
            >
              {spinner("delete")}
              Delete backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cacheOpen} onOpenChange={setCacheOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear cache?</DialogTitle>
            <DialogDescription>
              Downloaded artwork, lyrics, and temporary library data will be
              removed and rebuilt when needed. Your data and music are not
              changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setCacheOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={busy === "cache"}
              onClick={() =>
                void run("cache", async () => {
                  const result = await clearParsonCache();
                  setCacheOpen(false);
                  await status.refetch();
                  toast.success(
                    `Cleared ${formatBytes(result.cleared_bytes)}.`,
                  );
                })
              }
            >
              {spinner("cache")}
              Clear cache
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (busy === "reset") return;
          setResetOpen(open);
          if (!open) setResetConfirmation("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Parson?</DialogTitle>
            <DialogDescription>
              This removes every account, setting, playlist, history entry, and
              the library index after restart. Your music files and safety
              backup remain.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm text-zinc-300">
            <span>
              Type <strong className="text-white">RESET PARSON</strong> to
              continue.
            </span>
            <input
              autoComplete="off"
              autoFocus
              className="h-10 w-full rounded-md border border-white/[0.1] bg-white/[0.04] px-3 text-white outline-none focus:border-red-400"
              onChange={(event) => setResetConfirmation(event.target.value)}
              spellCheck={false}
              value={resetConfirmation}
            />
          </label>
          <DialogFooter className="gap-2">
            <Button
              disabled={busy === "reset"}
              onClick={() => setResetOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={
                busy === "reset" || resetConfirmation !== "RESET PARSON"
              }
              onClick={() =>
                void run("reset", async () => {
                  const result = await resetParson(resetConfirmation);
                  setResetOpen(false);
                  setResetConfirmation("");
                  await status.refetch();
                  toast.success(result.message, { duration: 10_000 });
                })
              }
              variant="destructive"
            >
              {spinner("reset")}
              Reset Parson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(restoreFile)}
        onOpenChange={(open) => {
          if (!open && busy !== "restore") setRestoreFile(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this private backup?</DialogTitle>
            <DialogDescription>
              Parson will validate and stage the backup. It replaces databases
              and user files only after a restart, with a rollback snapshot of
              the current data.
            </DialogDescription>
          </DialogHeader>
          <p className="truncate rounded-md bg-white/[0.04] px-3 py-2 text-sm text-zinc-300">
            {restoreFile?.name}
          </p>
          <DialogFooter className="gap-2">
            <Button
              disabled={busy === "restore"}
              onClick={() => setRestoreFile(null)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={busy === "restore"}
              onClick={() =>
                void run("restore", async () => {
                  if (!restoreFile) return;
                  const result = await restorePrivateBackup(restoreFile);
                  setRestoreFile(null);
                  await status.refetch();
                  toast.success(result.message, { duration: 10_000 });
                })
              }
            >
              {spinner("restore")}
              Validate and stage
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
