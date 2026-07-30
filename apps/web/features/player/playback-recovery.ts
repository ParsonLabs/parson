export const MEDIA_ERROR_NETWORK = 2;
export const MEDIA_ERROR_DECODE = 3;
export const MEDIA_ERROR_SOURCE_NOT_SUPPORTED = 4;

export function shouldRetryWithCompatibilityStream(
  mediaErrorCode: number | undefined,
  configuredBitrate: number,
  alreadyRetried: boolean,
) {
  return (
    configuredBitrate === 0 &&
    !alreadyRetried &&
    (mediaErrorCode === MEDIA_ERROR_DECODE ||
      mediaErrorCode === MEDIA_ERROR_SOURCE_NOT_SUPPORTED)
  );
}

export function shouldAdvancePastFailedTrack(
  mediaErrorCode: number | undefined,
  hasNextTrack: boolean,
) {
  return (
    hasNextTrack &&
    (mediaErrorCode === MEDIA_ERROR_NETWORK ||
      mediaErrorCode === MEDIA_ERROR_DECODE ||
      mediaErrorCode === MEDIA_ERROR_SOURCE_NOT_SUPPORTED)
  );
}
