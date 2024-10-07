"use client";

import React, { useState, useEffect, useRef, useContext } from "react";
import * as Tone from "tone";
import getSession from "@/lib/Authentication/JWT/getSession";
import getBaseURL from "@/lib/Server/getBaseURL";
import {
  Slider,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from "@music/ui/components/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@music/ui/components/popover";
import { FastAverageColor } from "fast-average-color";
import { AudioLines, BookAudioIcon, MicVocal, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AIContext } from "../AI/AIOverlayContext";
import ArrowPath from "../Icons/ArrowPath";
import IconQueue from "../Icons/IconQueue";
import IconPause from "../Icons/Pause";
import IconPlay from "../Icons/Play";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { useReverb } from "../Providers/SlowedReverbProvider";
import { usePlayer } from "./Player/usePlayer";
import VideoPlayerDialog from "./Player/VideoPlayerDialog";
import { PanelContext } from "./Queue/QueuePanelContext";
import { Input } from "@music/ui/components/input";
import { Label } from "@radix-ui/react-label";
import { useSession } from "../Providers/AuthProvider";

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
    let songURL = `${getBaseURL()}/api/stream/${encodeURIComponent(song.path)}?bitrate=${session && session.bitrate || 0}`;
    if (reverb) {
      songURL += "&slowed_reverb=true";
    }

    setAudioSource(songURL)    
    // player.current = new Tone.Player({
    //   url: songURL,
    //   onload: () => {
    //     player.current?.connect(pitchShift.current!);
    //     pitchShift.current?.connect(reverbEffect.current!);
    //     setIsLoaded(true);
    //     console.log('Player loaded');
    //   },
    //   onerror: (error) => {
    //     console.error('Error loading player:', error);
    //   }
    // }).toDestination();
  }, [reverb, song, setAudioSource, session]);

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

  const debouncedTogglePlayPause = debounce(togglePlayPause, 300);

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  return song.id && (
    <footer className="z-50 fixed bottom-0 border-t border-gray-800 px-3 py-3 flex flex-col md:flex-row items-center justify-between md:gap-4 w-full" 
      style={{ 
        backgroundColor: "#212121",
        transition: 'background-color 0.5s ease',
        height: "100px"
      }}>
      <Image
        className="bg-cover bg-center blur-3xl"
        src={isPlaying ? imageSrc : ""}
        alt="Background Image"
        height={1000}
        width={1000}
        style={{
          backgroundColor: isPlaying ? "none" : "#202020",
          transition: "background background-color 0.5s ease",
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          filter: 'blur(96px) brightness(50%)',
          zIndex: -1
        }}
      />
    
      <section className="flex flex-col md:flex-row items-center justify-between gap-3 w-full md:w-1/4">
        <div className="flex items-center w-full md:w-1/2 justify-center">
          <Slider
            min={0}
            max={duration}
            value={[currentTime]}
            onValueChange={([values]) => {
              handleTimeChange(Number(values));
            }}
            className="w-full group md:hidden"
          >
            <SliderTrack className="h-1 bg-gray-400 cursor-pointer">
              <SliderRange
                className="bg-gray-500"
                style={{ width: `${(bufferedTime / duration) * 100}%` }}
              />
              <SliderRange className="bg-black" />
            </SliderTrack>
            <SliderThumb className="cursor-pointer bg-white hidden group-hover:block size-4" />
          </Slider>
        </div>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-full h-12 md:w-20 md:h-20 bg-gray-500 rounded-md">
              <Image
                alt={song.name + "Image"}
                src={imageSrc}
                height={400}
                width={400}
                className="w-full h-full object-fill rounded"
              />
            </div>
            <div className="w-80 md:overflow-hidden">
              <p
                className={`${song.name.length > 30 && "whitespace-nowrap"} ${song.name.length > 30 ? "md:animate-marquee" : ""}`}
                title={song.name.length > 30 ? song.name : ""}
              >
                <Link href={`/album?id=${album.id}`}>{song.name}</Link>
              </p>
              <p className="text-xs text-gray-400">
                <Link href={`/artist?id=${artist.id}`}>{artist.name}</Link>
                {song.contributing_artists.map((artist, index) => (
                  <span key={index}>
                    , <Link href={`/artist?id=${song.contributing_artist_ids[index]}`}>{artist}</Link>
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="text-gray-400 hover:text-white transition-colors duration-300 md:hidden">
            <button onClick={debouncedTogglePlayPause}>
              {isPlaying ? <IconPause /> : <IconPlay />}
            </button>
          </div>
        </div>
      </section>
  
      <section className="md:flex flex-col items-center gap-2 w-full hidden">
        <div className="flex items-center gap-4">
          <button onClick={() => playPreviousSong()}><SkipBack className="w-5 h-5" /></button>
          <button onClick={debouncedTogglePlayPause}>
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>
          <button onClick={() => playNextSong()}><SkipForward className="w-5 h-5"/></button>
          <button onClick={() => toggleLoopSong()}>
            {onLoop ? <ArrowPath style={{ strokeWidth: 2, color: 'white' }} /> : <ArrowPath />}
          </button>
        </div>
        <div className="flex items-center gap-2 w-full justify-center">
          <span className="text-xs text-gray-400">{formatTime(currentTime)}</span>
  
        <Slider
          min={0}
          max={duration}
          value={[currentTime]}
          onValueChange={([values]) => {
            handleTimeChange(Number(values))
          }}
          className="w-1/2 group"
        >
          <SliderTrack className="h-1 bg-gray-400 cursor-pointer">
            <SliderRange className="bg-gray-500" style={{ width: `${(bufferedTime / duration) * 100}%` }} />
            <SliderRange className="bg-black" />
          </SliderTrack>
  
          <SliderThumb className="cursor-pointer bg-white hidden group-hover:block size-4" />
        </Slider>
            <span className="text-xs text-gray-400">{formatTime(duration)}</span>
        </div>
      </section>
  
      <section className="hidden md:flex items-center gap-2">
        <button
          onClick={() => {
            toggleLyrics();
            setIsLyricsClicked(!isLyricsClicked);
          }}
        >
          <MicVocal color={isLyricsClicked ? 'white' : 'gray'} />
        </button>
  
        {song.music_video?.url && <VideoPlayerDialog url={song.music_video.url} /> }
  
        {process.env.NEXT_PUBLIC_AI_URL && (
          <button
            onClick={() => {
              toggleAI();
              setIsAIClicked(!isAIClicked);
            }}
          >
            <BookAudioIcon color={isAIClicked ? 'white' : 'gray'} />
          </button>
        )}
  
        <button
          onClick={() => {
            togglePanel();
            setIsQueueClicked(!isQueueClicked);
          }}
        >
          <IconQueue color={isQueueClicked ? 'white' : 'gray'} />
        </button>
        {/* <Popover> */}
          {/* <PopoverTrigger asChild> */}
            <button
              onClick={() => {
                setReverb(!reverb)
                setIsReverbClicked(!isReverbClicked);
              }}
            >
              <AudioLines color={isReverbClicked ? 'white' : 'gray'} />
            </button>
          {/* </PopoverTrigger> */}
          {/* <PopoverContent className="w-80"> */}
            {/* <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Audio Effects</h4>
                <p className="text-sm text-muted-foreground">
                  Adjust the audio effects for the current track.
                </p>
              </div>
              <div className="grid gap-2">
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="slowed">Slowed</Label>
                  <Input
                    id="slowed"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={slowed}
                    onInput={handleSlowedChange}
                    className="col-span-2 h-8"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="reverb">Reverb</Label>
                  <Input
                    id="reverb"
                    type="range"
                    min="0"
                    max="10"
                    step="0.1"
                    value={reverbEffectValue}
                    onInput={handleReverbChange}
                    className="col-span-2 h-8"
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <Label htmlFor="pitch">Pitch</Label>
                  <Input
                    id="pitch"
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={pitch}
                    onInput={handlePitchChange}
                    className="col-span-2 h-8"
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover> */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleMute()}
            onMouseEnter={() => setIsSpeakerHovered(true)}
            onMouseLeave={() => setIsSpeakerHovered(false)}
          >
            {muted || !volume ? (
              <VolumeX color={isSpeakerHovered ? "white" : "gray"} />
            ) : (
              <Volume2 color={isSpeakerHovered ? "white" : "gray"} />
            )}
          </button>
          <Slider
            min={0}
            max={100}
            value={[volume * 100]}
            onValueChange={([values]: number[]) => {
              setAudioVolume(Number(values));
            }}
            className="group"
          >
            <SliderTrack className="h-1 w-20 bg-gray-400 cursor-pointer">
              <SliderRange className="bg-black" />
            </SliderTrack>
            <SliderThumb className="cursor-pointer bg-white hidden group-hover:block size-4" />
          </Slider>
        </div>
      </section>
    </footer>
  );
}