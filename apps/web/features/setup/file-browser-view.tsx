"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { LibraryIndexReport } from "@parson/music-sdk";
import { ChevronRight, Folder, FolderUp, Loader2 } from "lucide-react";
import { parentDirectory } from "./setup-state";

export interface Directory {
  name: string;
  path: string;
}

export function FileBrowserView({
  actionLabel,
  currentDirectory,
  directories,
  directoryError,
  disabled,
  indexMessage,
  indexReport,
  isIndexing,
  isRefreshing,
  onIndex,
  onNavigate,
  onOpenNativePicker,
  onRefresh,
  onRetry,
  onShowHiddenChange,
  showHidden,
  setupMode,
}: {
  actionLabel?: string;
  currentDirectory: string;
  directories: Directory[];
  directoryError: boolean;
  disabled: boolean;
  indexMessage: string | null;
  indexReport: LibraryIndexReport | null;
  isIndexing: boolean;
  isRefreshing: boolean;
  onIndex: () => void;
  onNavigate: (path: string) => void;
  onOpenNativePicker?: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onShowHiddenChange: (show: boolean) => void;
  showHidden: boolean;
  setupMode: boolean;
}) {
  const navigationRow = (label: string, path: string) => (
    <button
      type="button"
      className="flex h-11 w-full items-center gap-3 border-b border-white/10 px-3 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
      onClick={() => onNavigate(path)}
      title={path}
    >
      <FolderUp className="h-4 w-4 text-zinc-500" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="h-4 w-4 text-zinc-600" />
    </button>
  );

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-black">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-white">Library</h2>
          {onOpenNativePicker && (
            <Button
              variant="outline"
              className="h-8 rounded-md border-white/10 bg-white/[0.03] px-3 text-xs text-zinc-200 hover:bg-white/[0.08] hover:text-white"
              onClick={onOpenNativePicker}
            >
              {setupMode ? "Choose folder" : "Change folder"}
            </Button>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-zinc-500">
          {currentDirectory}
        </p>
      </div>
      <div className="p-6">
        <div className="overflow-hidden rounded-md border border-white/10">
          {navigationRow("Parent folder", parentDirectory(currentDirectory))}
          <div className="h-80 overflow-y-auto">
            {directoryError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
                <p className="text-sm text-zinc-400">
                  This folder could not be opened.
                </p>
                <button
                  type="button"
                  className="text-sm font-medium text-white hover:underline"
                  onClick={onRetry}
                >
                  Try again
                </button>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {directories.map((directory) => (
                  <button
                    key={directory.path}
                    type="button"
                    className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-white"
                    title={directory.path}
                    onClick={() => onNavigate(directory.path)}
                  >
                    <Folder className="h-4 w-4 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate">
                      {directory.name}
                    </span>
                    <ChevronRight className="h-4 w-4 text-zinc-600" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
          <Checkbox
            checked={showHidden}
            onCheckedChange={(checked) => onShowHiddenChange(checked === true)}
          />
          Show hidden folders
        </label>
        {(indexMessage || indexReport) && (
          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-zinc-300">
            {indexMessage && <p>{indexMessage}</p>}
            {indexReport && (
              <p className="mt-1 text-zinc-500">
                {indexReport.indexed_files} indexed, {indexReport.skipped_files}{" "}
                skipped, {indexReport.warnings.length} warnings.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-white/[0.025] px-6 py-4">
        {!setupMode && (
          <Button
            variant="outline"
            className="h-9 rounded-md border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-zinc-200 hover:bg-white/[0.08] hover:text-white"
            onClick={onRefresh}
            disabled={isRefreshing || isIndexing}
          >
            {isRefreshing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isRefreshing ? "Checking..." : "Check for changes"}
          </Button>
        )}
        <Button
          className="h-9 rounded-md bg-white px-4 text-sm font-medium text-black hover:bg-zinc-200"
          onClick={onIndex}
          disabled={disabled || isIndexing || isRefreshing}
        >
          {isIndexing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isIndexing
            ? setupMode
              ? "Adding your music…"
              : "Updating library…"
            : actionLabel || "Use this folder"}
        </Button>
      </div>
    </section>
  );
}
