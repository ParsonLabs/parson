const featuredArtistQualifier =
  /\s*[\[(]\s*(?:feat(?:uring)?\.?|ft\.?)\s+[^)\]]+[)\]]/giu;
const explicitQualifier =
  /\s*[\[(]\s*explicit(?:\s+(?:ver\.?|version|edit))?\s*[)\]]/giu;

export function isExplicitSongTitle(title: string) {
  return new RegExp(explicitQualifier.source, "iu").test(title);
}

export function displaySongTitle(title: string) {
  const displayed = title
    .replace(featuredArtistQualifier, "")
    .replace(explicitQualifier, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return displayed || title.trim();
}
