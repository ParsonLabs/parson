import { ImageOff } from "lucide-react";

export function isPlaceholderImage(image?: string | null) {
  const normalized = (image ?? "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "snf.png" ||
    normalized.endsWith("/snf.png") ||
    normalized.includes("snf.png?")
  );
}

export function getLibraryImageUrl(
  image: string | null | undefined,
  getBaseUrl: () => string,
) {
  if (isPlaceholderImage(image)) return null;
  if (/^https?:\/\//i.test(image ?? "")) return image ?? null;

  return `${getBaseUrl()}/media/images/${encodeURIComponent(image ?? "")}`;
}

export function AlbumArtFallback({
  label = "Album art unavailable",
}: {
  label?: string;
}) {
  return (
    <div
      className="h-full w-full rounded-[inherit] bg-[radial-gradient(circle_at_22%_16%,rgba(255,255,255,0.045),transparent_70%),linear-gradient(135deg,#181818,#0c0c0c)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      aria-label={label}
    />
  );
}

export function OptionalImageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-[inherit] bg-white/[0.035] text-zinc-500">
      <ImageOff className="h-5 w-5" />
    </div>
  );
}
