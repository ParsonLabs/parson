import {
  getPlaybackQueueRevisionConflict,
  updatePlaybackQueuePosition,
} from "@parson/music-sdk";

export type PersistedQueueState = { id: string; revision: number };
type QueuePositionUpdater = typeof updatePlaybackQueuePosition;

export async function syncQueuePosition(
  queue: PersistedQueueState,
  position: number,
  update: QueuePositionUpdater = updatePlaybackQueuePosition,
): Promise<PersistedQueueState> {
  try {
    const saved = await update(queue.id, position, queue.revision);
    return { id: queue.id, revision: saved.revision };
  } catch (cause) {
    const conflict = getPlaybackQueueRevisionConflict(cause);
    if (!conflict) throw cause;
    if (conflict.current_position === position) {
      return { id: queue.id, revision: conflict.revision };
    }
    const saved = await update(queue.id, position, conflict.revision);
    return { id: queue.id, revision: saved.revision };
  }
}
