import Link from "next/link";
import type { TrackArtistCreditPart } from "./track-artist-credit";

export function ArtistCreditLinks({
  credits,
  onNavigate,
}: {
  credits: TrackArtistCreditPart[];
  onNavigate?: () => void;
}) {
  return credits.map((credit, index) => (
    <span key={`${credit.id ?? credit.name}-${index}`}>
      {index > 0 && ", "}
      {credit.id ? (
        <Link
          className="pointer-events-auto relative z-20 hover:text-white hover:underline"
          href={`/artist?id=${credit.id}`}
          onClick={onNavigate}
        >
          {credit.name}
        </Link>
      ) : (
        credit.name
      )}
    </span>
  ));
}
