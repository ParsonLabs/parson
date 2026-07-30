const creditSeparator =
  /\s+(?:&|featuring|ft\.?|with|feat\.?|and|presents|vs\.?|x)\s+|,\s*|;/i;

const normalizeArtist = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

const splitCredit = (value: string) =>
  value
    .split(creditSeparator)
    .map((artist) => artist.trim())
    .filter(Boolean);

const distinctArtists = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((artist) => {
    const normalized = normalizeArtist(artist);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

export function trackArtistCredit({
  albumArtist,
  albumType,
  contributingArtists,
  trackArtist,
}: {
  albumArtist: string;
  albumType?: string | null;
  contributingArtists?: string[];
  trackArtist: string;
}) {
  const primaryArtist = trackArtist.trim() || albumArtist.trim();
  const primaryCredits = splitCredit(primaryArtist);
  const contributors = distinctArtists(
    (contributingArtists ?? []).flatMap(splitCredit),
  );
  const credits = distinctArtists([...primaryCredits, ...contributors]);
  const albumArtistKey = normalizeArtist(albumArtist);
  const isVariousArtists = ["various artists", "various", "va"].includes(
    albumArtistKey.replaceAll(".", ""),
  );
  const needsCredit =
    credits.some((artist) => normalizeArtist(artist) !== albumArtistKey) ||
    normalizeArtist(albumType ?? "").includes("compilation") ||
    isVariousArtists;

  if (!needsCredit) return null;
  const primaryKeys = new Set(primaryCredits.map(normalizeArtist));
  const guests = contributors.filter(
    (artist) => !primaryKeys.has(normalizeArtist(artist)),
  );
  return guests.length
    ? `${primaryArtist} feat. ${guests.join(", ")}`
    : primaryArtist;
}
