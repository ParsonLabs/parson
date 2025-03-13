import React, { useState, useRef, useEffect } from 'react';
import ReactPlayer from 'react-player/youtube';
import { X, Minimize, Maximize, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { Slider } from '@music/ui/components/slider';

interface YouTubeMiniPlayerProps {
  video: {
    id: string;
    title: string;
    thumbnail: string;
    url: string;
    channel: {
      name: string;
    };
  };
  onClose: () => void;
}

export default function YouTubeMiniPlayer({ video, onClose }: YouTubeMiniPlayerProps) {
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const playerRef = useRef<ReactPlayer>(null);
  
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handlePlayPause = () => {
    setPlaying(!playing);
  };

  const handleVolumeChange = (value: number[]) => {
    if (value[0]) {
        setVolume(value[0] / 100);
        if (muted && value[0] > 0) {
          setMuted(false);
        }
    }
  };

  const toggleMute = () => {
    setMuted(!muted);
  };

  const handleProgress = (state: { playedSeconds: number }) => {
    setCurrentTime(state.playedSeconds);
  };

  const handleSeek = (value: number[]) => {
    const newTime = value[0];
    if (newTime) {
      setCurrentTime(newTime);
      playerRef.current?.seekTo(newTime);
    }
  };

  return (
    <div
      className={`fixed bottom-24 right-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl overflow-hidden z-50 transition-all duration-300 ${
        minimized ? 'w-72' : 'w-96'
      }`}
    >
      <div className="flex justify-between items-center p-2 bg-zinc-950">
        <div className="text-sm font-medium text-white truncate max-w-[240px]">
          {video.title}
        </div>
        <div className="flex space-x-2">
          <button 
            onClick={() => setMinimized(!minimized)}
            className="text-gray-400 hover:text-white"
          >
            {minimized ? <Maximize size={16} /> : <Minimize size={16} />}
          </button>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-red-500"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="w-full aspect-video bg-black">
          <ReactPlayer
            ref={playerRef}
            url={video.url}
            playing={playing}
            volume={volume}
            muted={muted}
            width="100%"
            height="100%"
            onDuration={setDuration}
            onProgress={handleProgress}
            config={{
              playerVars: { 
                modestbranding: 1,
                fs: 0,
              }
            }}
          />
        </div>
      )}

      <div className="p-2 flex flex-col gap-2">
        {minimized && (
          <div className="text-xs text-gray-400 truncate">
            {video.channel.name}
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8 text-right">
            {formatTime(currentTime)}
          </span>
          <Slider
            min={0}
            max={duration || 1}
            value={[currentTime]}
            onValueChange={handleSeek}
            className="w-full"
          />
          <span className="text-xs text-gray-400 w-8">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <button 
            onClick={handlePlayPause}
            className="text-white hover:bg-gray-800 p-1 rounded-full"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>

          <div className="flex items-center space-x-1 w-24">
            <button 
              onClick={toggleMute}
              className="text-gray-400 hover:text-white"
            >
              {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <Slider
              min={0}
              max={100}
              value={[muted ? 0 : volume * 100]}
              onValueChange={handleVolumeChange}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}