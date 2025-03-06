// components/Music/Player/YouTubePlayer.tsx
"use client"

import { useState, useRef, useImperativeHandle, forwardRef, useEffect, useCallback } from "react"
import ReactPlayer from "react-player/youtube";

interface YouTubePlayerProps {
  url: string;
  isPlaying: boolean;
  volume: number;
  currentTime: number;
  onProgress: (state: { playedSeconds: number; loadedSeconds: number }) => void;
  onDuration: (duration: number) => void;
  onEnded: () => void;
}

const YouTubePlayer = forwardRef(({
  url,
  isPlaying,
  volume,
  currentTime,
  onProgress,
  onDuration,
  onEnded,
}: YouTubePlayerProps, ref) => {
  const playerRef = useRef<ReactPlayer>(null);
  const [lastDuration, setLastDuration] = useState<number>(0);
  const skipProgressRef = useRef<boolean>(false);
  const lastSeekTime = useRef<number>(0);
  
  useImperativeHandle(ref, () => ({
    seekTo: (time: number, type: 'seconds' | 'fraction' = 'seconds') => {
      if (playerRef.current) {
        playerRef.current.seekTo(time, type);
        lastSeekTime.current = time;
        skipProgressRef.current = true;
        setTimeout(() => {
          skipProgressRef.current = false;
        }, 500);
      }
    },
    getDuration: getPlayerDuration,
    getCurrentTime: () => playerRef.current?.getCurrentTime() || 0
  }), []);
  
  useEffect(() => {
    const currentPlayerTime = playerRef.current?.getCurrentTime() || 0;
    if (
      playerRef.current && 
      Math.abs(currentTime - currentPlayerTime) > 1 && 
      !skipProgressRef.current
    ) {
      playerRef.current.seekTo(currentTime, 'seconds');
      lastSeekTime.current = currentTime;
    }
  }, [currentTime]);
  
  const handleDurationChange = (duration: number) => {
    if (duration > 0 && !isNaN(duration)) {
      setLastDuration(duration);
      onDuration(duration);
    }
  };
  
  useEffect(() => {
    if (lastDuration > 0) {
      onDuration(lastDuration);
    }
  }, [isPlaying, lastDuration, onDuration]);
  
  const getPlayerDuration = useCallback(() => {
    const playerDuration = playerRef.current?.getDuration();
    if (playerDuration && !isNaN(playerDuration) && playerDuration > 0) {
      return playerDuration;
    }
    return lastDuration;
  }, [lastDuration]);
  
  const handleProgress = (state: { playedSeconds: number; loadedSeconds: number }) => {
    if (skipProgressRef.current) return;
    
    const diff = Math.abs(state.playedSeconds - lastSeekTime.current);
    if (diff < 1 && lastSeekTime.current > 0) return;
    
    onProgress(state);
  };
  
  return (
    <div style={{ display: 'none' }}>
      <ReactPlayer
        ref={playerRef}
        url={url}
        playing={isPlaying}
        volume={volume / 100}
        controls={false}
        width="0"
        height="0"
        progressInterval={500}
        onProgress={(state) => {
          if (!skipProgressRef.current) {
            onProgress(state);
          }
        }}
        onDuration={handleDurationChange}
        onEnded={onEnded}
        onReady={() => {
          const duration = playerRef.current?.getDuration();
          if (duration && !isNaN(duration) && duration > 0) {
            handleDurationChange(duration);
          }
        }}
        config={{
          playerVars: {
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            origin: window.location.origin
          }
        }}
      />
    </div>
  );
});

// Important: Set display name
YouTubePlayer.displayName = "YouTubePlayer";

// Export the component
export default YouTubePlayer;