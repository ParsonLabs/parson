type TrackArtistCreditInput = {
  albumArtist: string;
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
  /\s+(?:&|featuring|ft\.?|with|feat\.?|and|presents|vs\.?|x)\s+|,\s*|;/i;

function normalizedArtist(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function splitCredit(value: string) {
  return value
    .split(creditSeparator)
    .map((artist) => artist.trim())
    .filter(Boolean);
}

function distinctArtists(values: string[]) {
  const seen = new Set<string>();
  return values.filter((artist) => {
    const normalized = normalizedArtist(artist);
    if (!normalized || seen.has(normalized)) return false;
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

  if (!hasDifferentCredit && !releaseNeedsCredits) return null;

  const primaryKeys = new Set(primaryCredits.map(normalizedArtist));
  const additionalArtists = contributors.filter(
    (artist) => !primaryKeys.has(normalizedArtist(artist)),
  );
  return [
    { name: primaryArtist },
    ...additionalArtists.map((name) => ({
      id: contributorIds.get(normalizedArtist(name)),
      name,
    })),
  ];
}

export function trackArtistCredit(input: TrackArtistCreditInput) {
  const parts = trackArtistCreditParts(input);
  if (!parts) return null;
  return parts.length > 1
    ? `${parts[0]?.name} feat. ${parts
        .slice(1)
        .map((part) => part.name)
        .join(", ")}`
    : (parts[0]?.name ?? null);
}
