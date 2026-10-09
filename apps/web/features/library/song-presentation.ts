const featuredArtistQualifier =
  /[\[(] *(?:feat(?:uring)?\.?|ft\.?) +[^()[\]]+[)\]]/giu;
const explicitQualifier =
  /[\[(] *explicit(?: +(?:ver\.?|version|edit))? *[)\]]/giu;

export function isExplicitSongTitle(title: string) {
  return new RegExp(explicitQualifier.source, "iu").test(
    title.replace(/\s+/g, " "),
  );
}

export function displaySongTitle(title: string) {
  const displayed = title
    .replace(/\s+/g, " ")
    .replace(featuredArtistQualifier, "")
    .replace(explicitQualifier, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return displayed || title.trim();
}
