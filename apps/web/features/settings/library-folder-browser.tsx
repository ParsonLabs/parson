"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { parentDirectory } from "@/features/setup/setup-state";
import { listDirectory } from "@parson/music-sdk";
import { ChevronRight, Folder, FolderUp, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Directory {
  name: string;
  path: string;
}

export function LibraryFolderBrowser({
  busy,
  initialDirectory,
  onCancel,
  onSelect,
}: {
  busy: boolean;
  initialDirectory: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const [currentDirectory, setCurrentDirectory] = useState(initialDirectory);
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [directoryError, setDirectoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const request = useRef(0);

  const loadDirectory = useCallback(
    async (path: string) => {
      const requestId = ++request.current;
      setLoading(true);
      try {
        const nextDirectories = await listDirectory(path, showHidden);
        if (requestId !== request.current) return;
        setDirectories(nextDirectories);
        setDirectoryError(false);
      } catch {
        if (requestId !== request.current) return;
        setDirectories([]);
        setDirectoryError(true);
      } finally {
        if (requestId === request.current) setLoading(false);
      }
    },
    [showHidden],
  );

  useEffect(() => {
    void loadDirectory(currentDirectory);
    return () => {
      request.current += 1;
    };
  }, [currentDirectory, loadDirectory]);

  function directoryRow(label: string, path: string, parent = false) {
    const Icon = parent ? FolderUp : Folder;
    return (
      <button
        className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
        key={path}
        onClick={() => setCurrentDirectory(path)}
        title={path}
        type="button"
      >
        <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
      </button>
    );
  }

  return (
    <>
      <p className="truncate rounded-md bg-white/[0.04] px-3 py-2 font-mono text-xs text-zinc-300">
        {currentDirectory}
      </p>
      <div className="mt-3 overflow-hidden rounded-md border border-white/10">
        <div className="border-b border-white/10">
          {directoryRow(
            "Parent folder",
            parentDirectory(currentDirectory),
            true,
          )}
        </div>
        <div className="h-72 overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2
                aria-label="Loading folders"
                className="h-5 w-5 animate-spin text-zinc-500"
              />
            </div>
          ) : directoryError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-zinc-400">
                This folder could not be opened.
              </p>
              <button
                className="text-sm font-medium text-white hover:underline"
                onClick={() => void loadDirectory(currentDirectory)}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : directories.length ? (
            <div className="divide-y divide-white/10">
              {directories.map((directory) =>
                directoryRow(directory.name, directory.path),
              )}
            </div>
          ) : (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
              No folders inside this directory.
            </p>
          )}
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
        <Checkbox
          checked={showHidden}
          onCheckedChange={(checked) => setShowHidden(checked === true)}
        />
        Show hidden folders
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button
          disabled={busy || loading || directoryError}
          onClick={() => onSelect(currentDirectory)}
        >
          {busy ? "Adding…" : "Use this folder"}
        </Button>
      </div>
    </>
  );
}
