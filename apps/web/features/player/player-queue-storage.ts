import type { QueueItem } from "./player-model";

const QUEUE_ID_KEY = "parson:playback-queue";
const QUEUE_SNAPSHOT_KEY = "parson:playback-queue-snapshot";

export function readStoredQueue() {
  try {
    return globalThis.localStorage?.getItem(QUEUE_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeQueue(id: string | null) {
  try {
    if (id) globalThis.localStorage?.setItem(QUEUE_ID_KEY, id);
    else globalThis.localStorage?.removeItem(QUEUE_ID_KEY);
  } catch {}
}

export type StoredQueueSnapshot = {
  index: number;
  items: QueueItem[];
  userId: string;
};

export function parseStoredQueueSnapshot(
  value: string | null,
  userId: string,
): StoredQueueSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredQueueSnapshot> & {
      version?: unknown;
    };
    if (
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.items) ||
      !parsed.items.length ||
      !parsed.items.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as QueueItem).song?.id === "string" &&
          Boolean((item as QueueItem).song.id),
      )
    )
      return null;
    const rawIndex = Number(parsed.index);
    const index = Number.isFinite(rawIndex)
      ? Math.min(
          Math.max(Math.trunc(rawIndex), 0),
          Math.max(parsed.items.length - 1, 0),
        )
      : 0;
    return { index, items: parsed.items, userId };
  } catch {
    return null;
  }
}

export function readStoredQueueSnapshot(userId: string) {
  try {
    return parseStoredQueueSnapshot(
      globalThis.localStorage?.getItem(QUEUE_SNAPSHOT_KEY) ?? null,
      userId,
    );
  } catch {
    return null;
  }
}

export function storeQueueSnapshot(
  userId: string | undefined,
  items: QueueItem[],
  index: number,
) {
  if (!userId) return;
  try {
    if (!items.length) {
      globalThis.localStorage?.removeItem(QUEUE_SNAPSHOT_KEY);
      return;
    }
    globalThis.localStorage?.setItem(
      QUEUE_SNAPSHOT_KEY,
      JSON.stringify({ index, items, userId, version: 1 }),
    );
  } catch {}
}
