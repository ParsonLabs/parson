import { getSongsWithMusicVideos } from "@music/sdk";
import { MusicVideoSong } from "@music/sdk/types";
import { useEffect, useState } from "react";
import MusicVideoCard from "@/components/Music/Card/MusicVideoCard";
import { ScrollArea, ScrollBar } from "@music/ui/components/scroll-area";
import ArtistMusicVideoCard from "./ArtistMusicVideoCard";

type ArtistMusicVideosProps = {
  artistName: string;
};

export default function ArtistMusicVideos({ artistName }: ArtistMusicVideosProps) {
  const [videos, setVideos] = useState<MusicVideoSong[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchArtistMusicVideos() {
      try {
        const allVideos = await getSongsWithMusicVideos();
        const artistVideos = allVideos.filter(
          video => video.artist.toLowerCase() === artistName.toLowerCase()
        );
        setVideos(artistVideos);
      } catch (error) {
        console.error("Error fetching music videos:", error);
      } finally {
        setLoading(false);
      }
    }

    if (artistName) {
      fetchArtistMusicVideos();
    }
  }, [artistName]);

  if (loading || videos.length === 0) return null;

    return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-white mb-4">Music Videos</h2>
      <div className="bg-black/20 backdrop-blur-sm rounded-xl p-4">
        <ScrollArea>
          <div className="flex space-x-16 pb-4">
            {videos.map((video) => (
              <ArtistMusicVideoCard key={video.id} song={video} />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  )
}