type TrackArtistCreditInput = {
  albumArtist: string;
  albumArtistId?: string;
  albumType: string;
  contributingArtists: string[];
  contributingArtistIds?: string[];
  trackArtist: string;
};

export type TrackArtistCreditPart = {
  id?: string;
  name: string;
};

const creditSeparator =
  / (?:&|featuring|ft\.?|with|feat\.?|and|presents|vs\.?|x) |, *|;/i;

function normalizedArtist(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function splitCredit(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(creditSeparator)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function distinctArtists(values: string[]) {
  const seen = new Set<string>();
  return values.filter((artist) => {
    const normalized = normalizedArtist(artist);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function isVariousArtists(value: string) {
  return ["various artists", "various", "va"].includes(
    normalizedArtist(value).replaceAll(".", ""),
  );
}

export function trackArtistCreditParts({
  albumArtist,
  albumArtistId,
  albumType,
  contributingArtists,
  contributingArtistIds = [],
  trackArtist,
}: TrackArtistCreditInput): TrackArtistCreditPart[] | null {
  const primaryArtist = trackArtist.trim() || albumArtist.trim();
  const primaryCredits = splitCredit(primaryArtist);
  const contributorIds = new Map(
    contributingArtists.map((artist, index) => [
      normalizedArtist(artist),
      contributingArtistIds[index],
    ]),
  );
  const contributors = distinctArtists(
    contributingArtists.flatMap(splitCredit),
  );
  const allCredits = distinctArtists([...primaryCredits, ...contributors]);
  const albumArtistKey = normalizedArtist(albumArtist);
  const hasDifferentCredit = allCredits.some(
    (artist) => normalizedArtist(artist) !== albumArtistKey,
  );
  const releaseNeedsCredits =
    normalizedArtist(albumType).includes("compilation") ||
    isVariousArtists(albumArtist);

  if (!hasDifferentCredit && !releaseNeedsCredits) {
    return null;
  }

  return allCredits.map((name) => {
    const id =
      normalizedArtist(name) === albumArtistKey
        ? albumArtistId
        : contributorIds.get(normalizedArtist(name));
    return id ? { id, name } : { name };
  });
}

export function trackArtistCredit(input: TrackArtistCreditInput) {
  const parts = trackArtistCreditParts(input);
  if (!parts) {
    return null;
  }
  return parts.map((part) => part.name).join(", ");
}

export function catalogSongArtistCredits({
  name,
  artistName,
  artistId,
}: {
  name: string;
  artistName: string;
  artistId: string;
}): TrackArtistCreditPart[] {
  const guests = Array.from(
    name.matchAll(/[\[(]\s*(?:feat\.?|ft\.?|featuring)\s+([^\])]+)[\])]/gi),
    (match) => match[1]!,
  );
  return (
    trackArtistCreditParts({
      albumArtist: artistName,
      albumArtistId: artistId,
      albumType: "",
      contributingArtists: guests,
      trackArtist: artistName,
    }) ?? [{ id: artistId, name: artistName }]
  );
}
