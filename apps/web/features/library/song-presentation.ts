const featuredArtistQualifier =
  /\s*[\[(]\s*(?:feat(?:uring)?\.?|ft\.?)\s+[^)\]]+[)\]]/giu;

export function displaySongTitle(title: string) {
  const displayTitle = title
    .replace(featuredArtistQualifier, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return displayTitle || title.trim();
}
