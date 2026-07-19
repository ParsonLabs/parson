export function readStoredQueue() {
  try {
    return globalThis.localStorage?.getItem("parson:playback-queue") ?? null;
  } catch {
    return null;
  }
}

export function storeQueue(id: string | null) {
  try {
    if (id) globalThis.localStorage?.setItem("parson:playback-queue", id);
    else globalThis.localStorage?.removeItem("parson:playback-queue");
  } catch {}
}
