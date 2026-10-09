import { displaySongTitle } from "./song-presentation";

export function ExplicitBadge() {
  return (
    <span
      role="img"
      aria-label="Explicit"
      title="Explicit"
      className="mr-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-xs bg-zinc-400/20 text-[9px] font-semibold leading-none text-zinc-400 align-middle"
    >
      E
    </span>
  );
}

export function SongTitle({ title }: { title: string }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
      <span className="truncate">{displaySongTitle(title)}</span>
    </span>
  );
}
