"use client"

import Image from "next/image";

import {
  Slider,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from "@music/ui/components/slider";
import { FastAverageColor } from "fast-average-color";
import { BookAudioIcon, MicVocal, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useContext, useEffect, useRef, useState } from "react";
import { AIContext } from "../AI/AIOverlayContext";
import ArrowPath from "../Icons/ArrowPath";
import IconQueue from "../Icons/IconQueue";
import IconPause from "../Icons/Pause";
import IconPlay from "../Icons/Play";
import SpeakerWave from "../Icons/SpeakerWave";
import SpeakerXMark from "../Icons/SpeakerXMark";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { useGradientHover } from "../Providers/GradientHoverProvider";
import { usePlayer } from "./Player/usePlayer";
import VideoPlayerDialog from "./Player/VideoPlayerDialog";
import { PanelContext } from "./Queue/QueuePanelContext";

export default function Player() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [liked, setLiked] = useState(false);

  const { togglePanel } = useContext(PanelContext);
  const { toggleLyrics } = useContext(LyricsContext);
  const { toggleAI, isAIVisible } = useContext(AIContext)

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
  } = usePlayer();

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  useEffect(() => {
    if (isPlaying) document.title = `${song.name} | ParsonLabs Music`;
    if (!isPlaying) document.title = `ParsonLabs Music`
  }, [song, artist, isPlaying]);

  const { gradient } = useGradientHover()

  const [backgroundColour, setBackgroundColour] = useState("")

  useEffect(() => {
    if(imageSrc) {
      const fac = new FastAverageColor();
      const getColor = async () => {
        const color = await fac.getColorAsync(imageSrc);
        setBackgroundColour(color.hex);
      };
      getColor();
    }
  }, [imageSrc]);

  return song.id && (
    <footer className="z-50 fixed bottom-0 border-t border-gray-800 px-3 py-3 flex flex-col md:flex-row items-center justify-between md:gap-4 w-full" 
      style={{ 
        backgroundColor: "#212121",
        transition: 'background-color 0.5s ease',
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
            <div className="w-24 h-12 md:w-20 md:h-20 bg-gray-500 rounded-md">
              <Image
                alt={song.name + "Image"}
                src={imageSrc}
                height={400}
                width={400}
                className="w-full h-full object-fill rounded"
              />
            </div>
            <div className="w-32 md:overflow-hidden">
              <p
                className={`${song.name.length > 30 && "whitespace-nowrap"} ${song.name.length > 30 ? "md:animate-marquee" : ""}`}
                title={song.name.length > 30 ? song.name : ""}
              >
                <Link href={`/album?id=${album.id}`}>{song.name}</Link>
              </p>
              <p className="text-xs text-gray-400">
                <Link href={`/artist?id=${artist.id}`}>{artist.name}</Link>
              </p>
            </div>
          </div>
          <div className="text-gray-400 hover:text-white transition-colors duration-300 md:hidden">
            <button onClick={() => togglePlayPause()}>
              {isPlaying ? <IconPause /> : <IconPlay />}
            </button>
          </div>
        </div>
      </section>

      <section className="md:flex flex-col items-center gap-2 w-full hidden">
        <div className="flex items-center gap-4">
          <button onClick={() => playPreviousSong()}><SkipBack className="w-5 h-5" /></button>
          <button onClick={() => togglePlayPause()}>
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>
          <button onClick={() => playNextSong()}><SkipForward className="w-5 h-5"/></button>
          <button onClick={() => toggleLoopSong}>
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
        <button onClick={toggleLyrics}>
          <MicVocal />
        </button>

        {song.music_video?.url && <VideoPlayerDialog url={song.music_video.url} /> }


        {process.env.NEXT_PUBLIC_AI_URL && (
          <button onClick={toggleAI}>
            <BookAudioIcon />
          </button>
        )}

        <button onClick={togglePanel}>
          <IconQueue />
        </button>
        <div className="flex items-center gap-1">
          <button onClick={() => toggleMute()}>
            {muted || !volume ? <SpeakerXMark /> : <SpeakerWave />}
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
      <audio ref={audioRef} onTimeUpdate={() => handleTimeUpdate} />
    </footer>
  );
}
