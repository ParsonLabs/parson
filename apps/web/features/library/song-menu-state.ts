export type SongMenuQueueMetadata = {
  songId: string;
  songName: string;
  artistId: string;
  artistName: string;
  albumId: string;
  albumName: string;
  albumCover?: string;
};

export function songMenuQueueItem(metadata: SongMenuQueueMetadata) {
  return {
    song: {
      id: metadata.songId,
      name: metadata.songName,
      artist: metadata.artistName,
    },
    artist: { id: metadata.artistId, name: metadata.artistName },
    album: {
      id: metadata.albumId,
      name: metadata.albumName,
      cover_url: metadata.albumCover,
    },
  };
}
