import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@music/ui/components/dialog";
import { Video } from "lucide-react";
import { useEffect, useRef, useState } from 'react';
import ReactPlayer from 'react-player/youtube';
import { usePlayer } from './usePlayer';

export type VideoPlayerDialogProps = {
  url: string | undefined;
};

export default function VideoPlayerDialog({ url }: VideoPlayerDialogProps) {
  const { isPlaying, togglePlayPause, song, currentTime, handleTimeChange } = usePlayer();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const videoTimeRef = useRef(currentTime);
  const playerRef = useRef<ReactPlayer>(null);
  const hasUpdatedTimeRef = useRef(false);

   useEffect(() => {
    if (isPlaying && isDialogOpen) {
      togglePlayPause();
    }
  }, [isPlaying, isDialogOpen, togglePlayPause]);

  useEffect(() => {
    if (isDialogOpen && playerRef.current) {
      playerRef.current.seekTo(currentTime, 'seconds');
      hasUpdatedTimeRef.current = true;
    }
  }, [isDialogOpen, currentTime]);

  useEffect(() => {
    if (!isDialogOpen && hasUpdatedTimeRef.current) {
      handleTimeChange(videoTimeRef.current.toString());
      hasUpdatedTimeRef.current = false;
    }
  }, [isDialogOpen, handleTimeChange]);

  const handleReady = () => {
    if (playerRef.current) {
      playerRef.current.seekTo(videoTimeRef.current, 'seconds');
      playerRef.current.getInternalPlayer().playVideo();
    }
  };

  const handleProgress = ({ playedSeconds }: { playedSeconds: number }) => {
    videoTimeRef.current = playedSeconds;
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <button>
          <Video />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[1000px] h-[80vh] bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle>{song.name} Music Video</DialogTitle>
        </DialogHeader>
        <div className="flex items-center space-x-2 h-full rounded-sm">
          <ReactPlayer 
            ref={playerRef}
            controls
            width="100%"
            height={400}
            pip={true}
            playing={isDialogOpen}
            onReady={handleReady}
            onProgress={handleProgress}
            url={url}
          />
        </div>
        <DialogFooter className="sm:justify-start">
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}