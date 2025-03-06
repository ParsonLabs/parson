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
    toggleLoop,
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
      const timer = setTimeout(() => {
        togglePlayPause();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [song?.path]);

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

  const debouncedTogglePlayPause = useMemo(
    () => debounce(togglePlayPause, 150),
    [togglePlayPause]
  );

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
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return song.id && (
    <footer 
      className="z-50 fixed bottom-0 backdrop-blur-xl border-t border-white/5 px-3 py-2 
      flex flex-col md:flex-row items-center justify-between gap-3 w-full"
      style={{ 
        background: 'rgba(18, 18, 18, 0.98)',
        height: "80px",
        transition: 'all 0.3s ease',
      }}>
      <div 
        className="absolute inset-0 z-[-1]"
        style={{
          backgroundImage: `url(${isPlaying ? imageSrc : "/snf.png"})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.1,
          filter: 'blur(80px) saturate(180%)',
          transition: 'all 0.5s ease',
        }}
      />
  
      <section className="flex items-center w-full md:w-[30%] min-w-[300px]">
        <div className="group relative w-14 h-14 md:w-[60px] md:h-[60px] flex-shrink-0">
          <Image
            alt={song.name}
            src={imageSrc}
            height={400}
            width={400}
            className="w-full h-full object-cover rounded-md shadow-lg 
            transform transition-all duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 
            transition-opacity duration-200 rounded-md flex items-center justify-center">
            <button 
              onClick={() => togglePlayPause()}
              className="text-white transform scale-90 hover:scale-100 transition-transform duration-200"
            >
              {isPlaying ? <IconPause width={24} height={24} /> : <IconPlay width={24} height={24} />}
            </button>
          </div>
        </div>
  
        <div className="ml-4 flex-grow min-w-0">
          <p className="text-white font-medium truncate hover:text-white/80 transition-colors">
            <Link href={`/album?id=${album.id}`}>{song.name}</Link>
          </p>
          <p className="text-sm text-gray-400 truncate">
            <Link href={`/artist?id=${artist.id}`} className="hover:text-white/80 transition-colors">
              {artist.name}
            </Link>
            {song.contributing_artist_ids?.map((id, index) => (
              <span key={id}>
                , <Link href={`/artist?id=${id}`} className="hover:text-white/80 transition-colors">
                  {song.contributing_artists[index]}
                </Link>
              </span>
            ))}
          </p>
        </div>
      </section>
  
      <section className="flex flex-col items-center gap-2 w-full max-w-[45%] min-w-[400px] px-4">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => toggleLoop()}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <ArrowPath className={`w-5 h-5 ${onLoop ? 'text-white' : ''}`} />
          </button>
          <button 
            onClick={() => playPreviousSong()}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <SkipBack className="w-5 h-5" />
          </button>
          <button 
            onClick={() => togglePlayPause()}
            className="bg-white rounded-full p-3 hover:scale-105 transition-transform duration-200"
          >
            {isPlaying ? 
              <IconPause className="w-5 h-5 text-black" /> : 
              <IconPlay className="w-5 h-5 text-black ml-0.5" />
            }
          </button>
          <button 
            onClick={() => playNextSong()}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>
          <button className="text-gray-400 hover:text-white transition-colors">
            <Shuffle className="w-5 h-5" />
          </button>
        </div>
  
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-gray-400 w-10 text-right">
            {formatTime(currentTime)}
          </span>
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
            <SliderTrack className="h-1 bg-gray-800 rounded-full">
              <SliderRange 
                className="bg-gray-600 rounded-full" 
                style={{ width: `${(bufferedTime / duration) * 100}%` }} 
              />
              <SliderRange className="bg-white rounded-full" />
            </SliderTrack>
            <SliderThumb className="w-3 h-3 bg-white opacity-0 group-hover:opacity-100 transition-all" />
          </Slider>
          <span className="text-xs text-gray-400 w-10">
            {formatTime(duration)}
          </span>
        </div>
      </section>
  
      <section className="hidden md:flex items-center gap-4 w-[20%] justify-end pr-4">
        <ViewCommentsModal />
        <button
          className={`transition-colors ${isLyricsClicked ? 'text-white' : 'text-gray-400 hover:text-white'}`}
          onClick={() => {
            toggleLyrics();
            setIsLyricsClicked(!isLyricsClicked);
          }}
        >
          <MicVocal className="w-5 h-5" />
        </button>
  
        {song.music_video?.url && <VideoPlayerDialog url={song.music_video.url} />}
  
        {process.env.NEXT_PUBLIC_AI_URL && (
          <button
            className={`transition-colors ${isAIClicked ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => {
              toggleAI();
              setIsAIClicked(!isAIClicked);
            }}
          >
            <BookAudioIcon className="w-5 h-5" />
          </button>
        )}
  
        <button
          className={`transition-colors ${isQueueClicked ? 'text-white' : 'text-gray-400 hover:text-white'}`}
          onClick={() => {
            togglePanel();
            setIsQueueClicked(!isQueueClicked);
          }}
        >
          <IconQueue className="w-5 h-5" />
        </button>
  
        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => toggleMute()}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {muted || !volume ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
          <Slider
            min={0}
            max={100}
            value={[volume * 100]}
            onValueChange={([value]) => setAudioVolume(Number(value))}
            className="w-24 group"
          >
            <SliderTrack className="h-1 bg-gray-800 rounded-full">
              <SliderRange className="bg-white rounded-full" />
            </SliderTrack>
            <SliderThumb className="w-3 h-3 bg-white opacity-0 group-hover:opacity-100 transition-all" />
          </Slider>
        </div>
      </section>
    </footer>
  );
}