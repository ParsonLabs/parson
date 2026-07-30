type PreloadedMedia = Pick<HTMLMediaElement, "error" | "readyState">;

// HAVE_FUTURE_DATA is 3. Keep the numeric value here so this predicate also
// remains testable outside a browser.
const HAVE_FUTURE_DATA = 3;

export function canPromotePreloadedMedia(
  element: PreloadedMedia | null,
  preloadedSource: string,
  requestedSource: string,
) {
  return (
    element !== null &&
    preloadedSource === requestedSource &&
    element.error === null &&
    element.readyState >= HAVE_FUTURE_DATA
  );
}
