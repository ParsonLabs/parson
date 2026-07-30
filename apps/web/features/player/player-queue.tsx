"use client";

import { defaultCover } from "@/lib/images/default-cover";
import getBaseURL from "@/lib/api/server-url";
import type { Player } from "./player-api";
import { ListMusic, Play, X } from "lucide-react";
import Image from "next/image";
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { queueDropIndex } from "./player-queue-reorder";

export default function PlayerQueue({
  currentSongId,
  onClose,
  onReorder,
  onSelect,
  queue,
}: {
  currentSongId: string;
  onClose: () => void;
  onReorder: (from: number, to: number) => void;
  onSelect: (index: number) => void;
  queue: Player["queue"];
}) {
  const queueRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || queueRef.current?.contains(target)) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest("[data-player-queue-trigger]")
      ) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <aside
      aria-label="Queue"
      className="fixed bottom-[7.75rem] left-3 right-3 z-[60] flex max-h-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/95 text-white shadow-2xl backdrop-blur-2xl sm:left-auto sm:right-5 sm:w-[360px] lg:right-[max(1.25rem,calc((100vw-80px-min(960px,100vw-112px))/2))]"
      ref={queueRef}
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-semibold">Queue</h2>
        <button
          aria-label="Close queue"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      {queue.length ? (
        <PlayerQueueList
          currentSongId={currentSongId}
          onReorder={onReorder}
          onSelect={onSelect}
          queue={queue}
        />
      ) : (
        <div className="grid flex-1 place-items-center px-6 text-center">
          <div>
            <ListMusic className="mx-auto h-7 w-7 text-zinc-700" />
            <p className="mt-3 text-sm font-medium text-zinc-300">
              Nothing queued
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              Play a song or album to get started.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}

export function PlayerQueueList({
  className = "",
  currentSongId,
  onReorder,
  onSelect,
  queue,
}: {
  className?: string;
  currentSongId: string;
  onReorder: (from: number, to: number) => void;
  onSelect: (index: number) => void;
  queue: Player["queue"];
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    edge: "before" | "after";
    index: number;
  } | null>(null);
  const suppressClick = useRef(false);

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= queue.length) return;
    onReorder(from, to);
  };
  const drop = (event: DragEvent<HTMLButtonElement>, targetIndex: number) => {
    event.preventDefault();
    const sourceIndex =
      draggedIndex ?? Number(event.dataTransfer.getData("text/plain"));
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    move(
      sourceIndex,
      queueDropIndex(queue.length, sourceIndex, targetIndex, edge),
    );
    setDraggedIndex(null);
    setDropTarget(null);
  };
  const moveWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
  };

  return (
    <div
      aria-label="Playback queue. Drag rows to reorder, or use the arrow keys."
      className={`overflow-y-auto p-2 ${className}`}
    >
      {queue.map((item, index) => {
        const active = item.song.id === currentSongId;
        const cover = item.album.cover_url
          ? `${getBaseURL()}/media/images/${encodeURIComponent(item.album.cover_url)}`
          : defaultCover;
        return (
          <button
            aria-current={active ? "true" : undefined}
            aria-label={`${item.song.name || "Untitled song"}. Position ${index + 1} of ${queue.length}. Drag to reorder, or use the arrow keys.`}
            className={`group relative flex h-[62px] w-full cursor-grab items-center gap-3 rounded-xl p-2 text-left transition-colors active:cursor-grabbing ${
              active ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"
            } ${draggedIndex === index ? "opacity-60" : ""}`}
            data-native-drag="true"
            draggable
            key={`${item.song.id}-${index}`}
            onClick={() => {
              if (!suppressClick.current) onSelect(index);
            }}
            onDragEnd={() => {
              setDraggedIndex(null);
              setDropTarget(null);
              window.setTimeout(() => {
                suppressClick.current = false;
              }, 0);
            }}
            onDragOver={(event) => {
              if (draggedIndex === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              setDropTarget({
                edge:
                  event.clientY < bounds.top + bounds.height / 2
                    ? "before"
                    : "after",
                index,
              });
            }}
            onDragStart={(event) => {
              suppressClick.current = true;
              setDraggedIndex(index);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDrop={(event) => drop(event, index)}
            onKeyDown={(event) => moveWithKeyboard(event, index)}
            type="button"
          >
            {dropTarget?.index === index && draggedIndex !== index && (
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-white ${
                  dropTarget.edge === "before" ? "top-0" : "bottom-0"
                }`}
              />
            )}
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-zinc-900">
              <Image
                alt=""
                className="object-cover"
                draggable={false}
                fill
                sizes="44px"
                src={cover}
              />
              <span className="absolute inset-0 hidden place-items-center bg-black/50 group-hover:grid">
                <Play className="h-4 w-4 fill-white" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`truncate text-sm font-medium ${active ? "text-white" : "text-zinc-200"}`}
              >
                {item.song.name || "Untitled song"}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {item.artist.name || item.song.artist || "Unknown artist"}
              </p>
            </div>
            {active && <span className="mr-2 h-2 w-2 rounded-full bg-white" />}
          </button>
        );
      })}
    </div>
  );
}
