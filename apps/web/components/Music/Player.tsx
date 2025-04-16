"use client";

import getBaseURL from "@/lib/Server/getBaseURL";
import {
  Slider,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from "@music/ui/components/slider";
import { AudioLines, BookAudioIcon, MicVocal, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Tone from "tone";
import { AIContext } from "../AI/AIOverlayContext";
import ArrowPath from "../Icons/ArrowPath";
import IconQueue from "../Icons/IconQueue";
import IconPause from "../Icons/Pause";
import IconPlay from "../Icons/Play";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { useSession } from "../Providers/AuthProvider";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { useReverb } from "../Providers/SlowedReverbProvider";
import { usePlayer } from "./Player/usePlayer";
import VideoPlayerDialog from "./Player/VideoPlayerDialog";
import { PanelContext } from "./Queue/QueuePanelContext";
import ViewCommentsModal from "./Player/ViewComments";
import { motion } from "framer-motion";

export default function Player() {
  const [liked, setLiked] = useState(false);
  const { reverb, setReverb } = useReverb();

  const { togglePanel } = useContext(PanelContext);
  const { toggleLyrics } = useContext(LyricsContext);
  const { toggleAI, isAIVisible } = useContext(AIContext);
  const { gradient } = useGradientHover();

  const {
    isPlaying,
    onLoop,
    volume,
    currentTime,
    duration,
    togglePlayPause,
    toggleLoopSong,
    muted,
    setAudioVolume,
    handleTimeChange,
    handleTimeUpdate,
    toggleMute,
    imageSrc,
    playNextSong,
    playPreviousSong,
    song,
    bufferedTime,
    artist,
    album,
    setAudioSource,
    isDraggingSeekBar,
    setIsDraggingSeekBar
  } = usePlayer();

  const [isLyricsClicked, setIsLyricsClicked] = useState(false);
  const [isAIClicked, setIsAIClicked] = useState(false);
  const [isQueueClicked, setIsQueueClicked] = useState(false);
  const [isReverbClicked, setIsReverbClicked] = useState(false);
  const [isSpeakerHovered, setIsSpeakerHovered] = useState(false);

  const [slowed, setSlowed] = useState(1);
  const [reverbEffectValue, setReverbEffectValue] = useState(0);
  const [pitch, setPitch] = useState(0);
  const player = useRef<Tone.Player | null>(null);
  const reverbEffect = useRef<Tone.Reverb | null>(null);
  const pitchShift = useRef<Tone.PitchShift | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const { session } = useSession()

  useEffect(() => {
    reverbEffect.current = new Tone.Reverb().toDestination();
    pitchShift.current = new Tone.PitchShift().toDestination();
  }, []);

  useEffect(() => {
    const isYouTubeUrl = song?.path?.includes('youtube.com') || song?.path?.includes('youtu.be');
    
    if (isYouTubeUrl && !isPlaying) {
        togglePlayPause();
    }
  }, [song?.path, isPlaying, togglePlayPause]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      player.current = new Tone.Player({
        url,
        onload: () => {
          setIsLoaded(true);
          console.log('File loaded');
        },
        onerror: (error) => {
          console.error('Error loading file:', error);
        }
      }).connect(pitchShift.current!);
      pitchShift.current?.connect(reverbEffect.current!);
    }
  };

  const handleSlowedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    setSlowed(value);
    if (player.current) {
      player.current.playbackRate = value;
    }
  };

  const handleReverbChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    setReverbEffectValue(value);
    if (reverbEffect.current) {
      reverbEffect.current.decay = value;
    }
  };

  const handlePitchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(event.target.value);
    setPitch(value);
    if (pitchShift.current) {
      pitchShift.current.pitch = value;
    }
  };

  const handleClick = () => {
    console.log('handleClick called');
    if (Tone.context.state !== 'running') {
      Tone.context.resume();
    }
    if (player.current) {
      console.log('Player is initialized');
      if (isLoaded) {
        console.log('Player is loaded');
        if (player.current.state !== 'started') {
          console.log('Starting player');
          player.current.start();
        } else {
          console.log('Stopping player');
          player.current.stop();
        }
      } else {
        console.log('Player is not loaded yet');
      }
    } else {
      console.log('Player is not initialized');
    }
  };

  const debounce = (func: Function, wait: number) => {
    let timeout: NodeJS.Timeout;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

useEffect(() => {
    let originalTitle = document.title;
    if (isPlaying) {
      document.title = `${song.name} | ParsonLabs Music`;
    } else {
      document.title = originalTitle;
    }
  }, [song, isPlaying])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isFormElement = target.tagName === 'INPUT' || 
                           target.tagName === 'TEXTAREA' || 
                           target.contentEditable === 'true' ||
                           target.isContentEditable;
  
      if (e.code === 'Space' && !isFormElement) {
        e.preventDefault();
        e.stopPropagation();
        togglePlayPause();
      }
    };
  
    document.addEventListener('keydown', handleKeyPress, { capture: true });
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress, { capture: true });
    };
  }, [togglePlayPause]);

  const formatTime = (time: number) => {
    if (!time) return `0:00`
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return song.id && (
    <footer 
      className="z-50 fixed bottom-0 px-3 py-2 
      flex flex-col md:flex-row items-center justify-between gap-3 w-full
      border-t border-white/10 backdrop-blur-xl"
      style={{ 
        background: 'rgba(15, 15, 15, 0.85)',
        height: "80px",
        transition: 'all 0.3s ease',
      }}>
      <div 
        className="absolute inset-0 z-[-1] overflow-hidden"
        style={{
          backgroundImage: `url(${isPlaying ? imageSrc : "/snf.png"})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.07,
          filter: 'blur(100px) saturate(180%)',
          transition: 'all 0.8s ease',
        }}
      />
      
      <div className="absolute inset-0 z-[-1] bg-gradient-to-t from-black/90 to-transparent opacity-90" />
      
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-purple-500/30 via-blue-500/40 to-indigo-500/30" />

      <section className="flex items-center w-full md:w-[30%] min-w-[300px]">
        <div className="group relative w-14 h-14 md:w-[60px] md:h-[60px] flex-shrink-0">
          <motion.div
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 400, damping: 10 }}
          >
            <Image
              alt={song.name}
              src={imageSrc}
              height={400}
              width={400}
              className="w-full h-full object-cover rounded-md shadow-lg"
            />
            
            {isPlaying && (
              <div className="absolute inset-0 rounded-md ring-2 ring-white/20 animate-pulse" />
            )}
            
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 
              transition-opacity duration-200 rounded-md flex items-center justify-center backdrop-blur-sm">
              <motion.button 
                onClick={() => togglePlayPause()}
                className="text-white p-1.5 rounded-full bg-white/20"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                {isPlaying ? <IconPause width={20} height={20} /> : <IconPlay width={20} height={20} />}
              </motion.button>
            </div>
          </motion.div>
        </div>

        <div className="ml-4 flex-grow min-w-0">
          <p className="text-white font-medium truncate group">
            <Link href={`/album?id=${album.id}`} className="group-hover:text-purple-300 transition-colors">
              {song.name}
            </Link>
          </p>
          <p className="text-sm text-gray-400 truncate flex gap-1 items-center">
            <Link href={`/artist?id=${artist.id}`} className="hover:text-white transition-colors">
              {artist.name}
            </Link>
            {song.contributing_artist_ids?.map((id, index) => (
              <span key={id}>
                <span className="text-gray-600 mx-1">•</span>
                <Link href={`/artist?id=${id}`} className="hover:text-white transition-colors">
                  {song.contributing_artists[index]}
                </Link>
              </span>
            ))}
          </p>
        </div>
      </section>

      <section className="flex flex-col items-center gap-1.5 w-full max-w-[45%] min-w-[400px] px-2">
        <div className="flex items-center gap-5">
          <motion.button 
            whileHover={{ scale: 1.15, rotate: 15 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => toggleLoopSong()}
            className={`text-gray-400 hover:text-white transition-all rounded-full p-1.5 ${onLoop ? 'text-white bg-white/10' : ''}`}
            title="Repeat"
          >
            <ArrowPath className={`w-4.5 h-4.5 ${onLoop ? 'text-white' : ''}`} />
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => playPreviousSong()}
            className="text-gray-300 hover:text-white transition-all rounded-full p-1.5"
            title="Previous"
          >
            <SkipBack className="w-5 h-5" />
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => togglePlayPause()}
            className="bg-white rounded-full p-3 hover:shadow-lg hover:shadow-white/10 transition-all duration-200"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? 
              <IconPause className="w-5 h-5 text-black" /> : 
              <IconPlay className="w-5 h-5 text-black ml-0.5" />
            }
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => playNextSong()}
            className="text-gray-300 hover:text-white transition-all rounded-full p-1.5"
            title="Next"
          >
            <SkipForward className="w-5 h-5" />
          </motion.button>
          
          <motion.button 
            whileHover={{ scale: 1.15, rotate: -15 }}
            whileTap={{ scale: 0.95 }}
            className="text-gray-400 hover:text-white transition-all rounded-full p-1.5"
            title="Shuffle"
          >
            <Shuffle className="w-4.5 h-4.5" />
          </motion.button>
        </div>

        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-gray-400 w-10 text-right font-mono">
            {formatTime(currentTime)}
          </span>
          
          <div className="relative w-full group">
            <Slider
              min={0}
              max={duration || 100}
              value={[currentTime]}
              onValueChange={([value]) => handleTimeChange(value?.toString())}
              onValueCommit={([value]) => {
                handleTimeChange(value?.toString());
              }}
              onPointerDown={() => setIsDraggingSeekBar(true)}
              onPointerUp={() => setIsDraggingSeekBar(false)}
              className="w-full group"
            >
              <SliderTrack className="h-1.5 bg-gray-800 group-hover:bg-gray-700 rounded-full transition-colors">
                <div 
                  className="absolute h-full bg-white/20 rounded-full transition-all" 
                  style={{ width: `${(bufferedTime / duration) * 100}%` }} 
                />
                
                <SliderRange className="bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" />
              </SliderTrack>
              
              <SliderThumb className="w-3 h-3 bg-white shadow-sm shadow-purple-500/30 opacity-0 group-hover:opacity-100 transition-all" />
            </Slider>
            
            {isDraggingSeekBar && (
              <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-black/80 px-2 py-1 rounded text-xs text-white">
                {formatTime(currentTime)}
              </div>
            )}
          </div>
          
          <span className="text-xs text-gray-400 w-10 font-mono">
            {formatTime(duration)}
          </span>
        </div>
      </section>

      <section className="hidden md:flex items-center gap-3 w-[20%] justify-end pr-2">
        <div className="flex items-center gap-3">
          <ViewCommentsModal />
          
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className={`transition-all p-1.5 rounded-full ${isLyricsClicked ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white'}`}
            onClick={() => {
              toggleLyrics();
              setIsLyricsClicked(!isLyricsClicked);
            }}
            title="Lyrics"
          >
            <MicVocal className="w-4.5 h-4.5" />
          </motion.button>
      
          {song.music_video?.url && <VideoPlayerDialog url={song.music_video.url} />}
      
          {process.env.NEXT_PUBLIC_AI_URL && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className={`transition-all p-1.5 rounded-full ${isAIClicked ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white'}`}
              onClick={() => {
                toggleAI();
                setIsAIClicked(!isAIClicked);
              }}
              title="AI Analysis"
            >
              <BookAudioIcon className="w-4.5 h-4.5" />
            </motion.button>
          )}
      
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className={`transition-all p-1.5 rounded-full ${isQueueClicked ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white'}`}
            onClick={() => {
              togglePanel();
              setIsQueueClicked(!isQueueClicked);
            }}
            title="Queue"
          >
            <IconQueue className="w-4.5 h-4.5" />
          </motion.button>
        </div>
        
        <div className="flex items-center gap-2 ml-1 border-l border-white/10 pl-3">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => toggleMute()}
            className={`text-gray-400 hover:text-white transition-all p-1.5 rounded-full ${muted || !volume ? 'text-gray-500' : ''}`}
            title={muted || !volume ? "Unmute" : "Mute"}
          >
            {muted || !volume ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
          </motion.button>
          
          <div className="w-24 group transition-all">
            <Slider
              min={0}
              max={100}
              value={[volume * 100]}
              onValueChange={([value]) => setAudioVolume(Number(value))}
              className="group"
            >
              <SliderTrack className="h-1 bg-gray-800 group-hover:bg-gray-700 rounded-full transition-colors">
                <SliderRange className="bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" />
              </SliderTrack>
              <SliderThumb className="w-2.5 h-2.5 bg-white shadow-sm shadow-purple-500/30 opacity-0 group-hover:opacity-100 transition-all" />
            </Slider>
            
            <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 right-0 text-xs text-gray-400">
              {Math.round(volume * 100)}%
            </div>
          </div>
        </div>
      </section>
    </footer>
  );
}