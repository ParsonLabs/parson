"use client";

import {
  getLibraryUnavailable,
  indexLibrary,
  indexSetupLibrary,
  refreshCurrentLibrary,
  listDirectory,
  listSetupDirectory,
  type LibraryIndexReport,
} from "@parson/music-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createExclusiveOperations, parentDirectory } from "./setup-state";
import { FileBrowserView, type Directory } from "./file-browser-view";
import { hasDesktopBridge, selectMusicFolder } from "@/lib/desktop/bridge";

export default function FileBrowser({
  actionLabel,
  beforeIndex,
  disabled = false,
  initialDirectory = "/",
  onIndexFailed,
  onIndexStarted,
  onIndexed,
  setupMode = false,
}: {
  actionLabel?: string;
  beforeIndex?: () => boolean | Promise<boolean>;
  disabled?: boolean;
  initialDirectory?: string;
  onIndexFailed?: (error: unknown) => void | Promise<void>;
  onIndexStarted?: (path: string) => void | Promise<void>;
  onIndexed?: (report: LibraryIndexReport) => void | Promise<void>;
  setupMode?: boolean;
}) {
  const router = useRouter();
  const [currentDirectory, setCurrentDirectory] = useState(initialDirectory);
  const [currentDirectoryList, setCurrentDirectoryList] = useState<Directory[]>(
    [],
  );
  const [isIndexing, setIsIndexing] = useState(false);
  const [isRefreshingCurrent, setIsRefreshingCurrent] = useState(false);
  const [indexReport, setIndexReport] = useState<LibraryIndexReport | null>(
    null,
  );
  const [indexMessage, setIndexMessage] = useState<string | null>(null);
  const [directoryError, setDirectoryError] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [desktopBridgeAvailable, setDesktopBridgeAvailable] = useState(false);
  const directoryRequest = useRef(0);
  const mounted = useRef(true);
  const mutations = useRef(createExclusiveOperations());

  const updateList = useCallback(
    async (directoryPath: string) => {
      const request = ++directoryRequest.current;
      try {
        const directoryList = await (setupMode
          ? listSetupDirectory(directoryPath, showHidden)
          : listDirectory(directoryPath, showHidden));
        if (request !== directoryRequest.current) return;
        setCurrentDirectory(directoryPath);
        setCurrentDirectoryList(directoryList);
        setDirectoryError(false);
      } catch {
        if (request !== directoryRequest.current) return;
        if (directoryPath !== "/") {
          void updateList("/");
        } else {
          setCurrentDirectory("/");
          setCurrentDirectoryList([]);
          setDirectoryError(true);
        }
      }
    },
    [setupMode, showHidden],
  );

  function goBack() {
    void updateList(parentDirectory(currentDirectory));
  }

  useEffect(() => {
    setDesktopBridgeAvailable(hasDesktopBridge());
  }, []);

  useEffect(() => {
    mounted.current = true;
    void updateList(initialDirectory);
    return () => {
      mounted.current = false;
      directoryRequest.current += 1;
    };
  }, [initialDirectory, updateList]);

  async function handleIndexLibrary() {
    const selectedDirectory = currentDirectory;
    await mutations.current.run(async () => {
      setIsIndexing(true);
      setIndexMessage(null);
      setIndexReport(null);

      try {
        if (beforeIndex && !(await beforeIndex())) return;
        await onIndexStarted?.(selectedDirectory);
        const response = await (setupMode
          ? indexSetupLibrary(selectedDirectory)
          : indexLibrary(selectedDirectory));
        await onIndexed?.(response.report);
        if (!mounted.current) return;
        setIndexReport(response.report);
        setIndexMessage(
          setupMode ? "Your music is ready." : "Library updated.",
        );
        if (mounted.current && setupMode && !onIndexed)
          router.replace("/login");
      } catch (error) {
        await onIndexFailed?.(error);
        if (!mounted.current) return;
        const unavailable = getLibraryUnavailable(error);
        if (unavailable?.state === "indexing") {
          setIndexMessage("Indexing is already in progress.");
        } else {
          setIndexMessage(
            "Couldn’t index this folder. Choose another or try again.",
          );
        }
      } finally {
        if (mounted.current) setIsIndexing(false);
      }
    });
  }

  async function handleNativeFolderPicker() {
    const selected = await selectMusicFolder();
    if (selected) await updateList(selected);
  }

  async function handleRefreshCurrentLibrary() {
    await mutations.current.run(async () => {
      setIsRefreshingCurrent(true);
      setIndexMessage(null);
      setIndexReport(null);

      try {
        const result = await refreshCurrentLibrary();
        if (mounted.current) {
          setIndexMessage(
            result.failures.length
              ? `Refreshed ${result.refreshed.length} folder(s); ${result.failures.length} failed. Your available catalog was preserved.`
              : `Refreshed ${result.refreshed.length} library folder(s).`,
          );
        }
      } catch (error) {
        if (!mounted.current) return;
        const unavailable = getLibraryUnavailable(error);
        if (unavailable) {
          setIndexMessage(
            unavailable.message ||
              `Library is ${unavailable.state.replace(/_/g, " ")}.`,
          );
        } else {
          setIndexMessage("Current library could not be refreshed.");
        }
      } finally {
        if (mounted.current) setIsRefreshingCurrent(false);
      }
    });
  }

  return (
    <FileBrowserView
      actionLabel={actionLabel}
      currentDirectory={currentDirectory}
      directories={currentDirectoryList}
      directoryError={directoryError}
      disabled={disabled}
      indexMessage={indexMessage}
      indexReport={indexReport}
      isIndexing={isIndexing}
      isRefreshing={isRefreshingCurrent}
      onIndex={() => void handleIndexLibrary()}
      onNavigate={(path) => void updateList(path)}
      onOpenNativePicker={
        desktopBridgeAvailable
          ? () => void handleNativeFolderPicker()
          : undefined
      }
      onRefresh={() => void handleRefreshCurrentLibrary()}
      onRetry={() => void updateList(initialDirectory)}
      onShowHiddenChange={setShowHidden}
      showHidden={showHidden}
      setupMode={setupMode}
    />
  );
}
