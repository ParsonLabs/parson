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
  const [isHovered, setIsHovered] = useState(false);
  const videoTimeRef = useRef<number>(currentTime);
  const wasPlayingRef = useRef(false);
  const playerRef = useRef<ReactPlayer>(null);
  const dialogClosedRef = useRef(false);
  const timeSetRef = useRef(false);

  const validateTime = (time: number, duration: number): number => {
    if (isNaN(time) || time < 0) return 0;
    if (duration && time > duration) return duration;
    return time;
  };

  useEffect(() => {
    if (isDialogOpen) {
      dialogClosedRef.current = false;
      timeSetRef.current = false;
      
      if (isPlaying) {
        wasPlayingRef.current = true;
        togglePlayPause();
      }
    }
  }, [isDialogOpen, isPlaying, togglePlayPause]);

  useEffect(() => {
    if (!isDialogOpen && !dialogClosedRef.current) {
      dialogClosedRef.current = true;
      
      if (videoTimeRef.current !== undefined && !timeSetRef.current) {
        const duration = playerRef.current?.getDuration() ?? 0;
        const validTime = validateTime(videoTimeRef.current, duration);
        
        if (validTime > 0) {
          timeSetRef.current = true;
          handleTimeChange(validTime.toString());
        }
        
        if (wasPlayingRef.current) {
          setTimeout(() => {
            togglePlayPause();
            wasPlayingRef.current = false;
          }, 100);
        }
      }
    }
  }, [isDialogOpen, handleTimeChange, togglePlayPause]);
  
  useEffect(() => {
    if (!isDialogOpen) {
      videoTimeRef.current = currentTime;
    }
  }, [currentTime, isDialogOpen]);

  const handleReady = () => {
    if (playerRef.current && isDialogOpen) {
      const player = playerRef.current;
      const duration = player.getDuration();
      const validTime = validateTime(currentTime, duration);
      player.seekTo(validTime, 'seconds');
      if (isPlaying) {
        player.getInternalPlayer().playVideo();
      }
    }
  };

  const handleProgress = ({ playedSeconds }: { playedSeconds: number }) => {
    if (!isNaN(playedSeconds) && isDialogOpen) {
      videoTimeRef.current = playedSeconds;
    }
  };

  const handlePause = () => {
    if (playerRef.current && isDialogOpen) {
      videoTimeRef.current = playerRef.current.getCurrentTime();
    }
  };

  return (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <button
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Video color={isHovered ? "white" : "gray"} />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-[1000px] h-[80vh] bg-zinc-950 text-white">
        <DialogHeader>
          <DialogTitle>{song.name} Music Video</DialogTitle>
        </DialogHeader>
        <div className="flex items-center space-x-2 h-full rounded-sm">
          <ReactPlayer 
            ref={playerRef}
            controls
            width="100%"
            height="70vh"
            pip={true}
            playing={isDialogOpen}
            onReady={handleReady}
            onProgress={handleProgress}
            onPause={handlePause}
            url={url}
          />
        </div>
        <DialogFooter className="sm:justify-start">
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}