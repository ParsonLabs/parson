"use client";

import { ScrollArea } from "@music/ui/components/scroll-area";
import { FastAverageColor } from "fast-average-color";
import Image from "next/image";
import { useContext, useEffect, useRef, useState } from "react";
import { usePlayer } from "../Music/Player/usePlayer";
import { LyricsContext } from "./LyricsOverlayContext";
import { useReverb } from "../Providers/SlowedReverbProvider";
import { getSongInfo } from "@music/sdk";
import { LibrarySong } from "@music/sdk/types";

type QueuePanelProps = {
  children: React.ReactNode;
};

export interface LyricsObjectResponse {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string;
  syncedLyrics?: string;
}

const parseLyrics = (lyrics: string, slowdownFactor: number = 1) => {
  return lyrics.split("\n").map((line) => {
    const time = line.substring(line.indexOf("[") + 1, line.indexOf("]"));
    const text = line.substring(line.indexOf("]") + 1).trim();
    let minutes = 0,
      seconds = 0,
      hundredths = 0;

    if (time.includes(":")) {
      const timeParts = time.split(":");
      minutes = parseFloat(timeParts[0] ?? "0");
      if (timeParts[1]?.includes(".")) {
        const secondParts = timeParts[1].split(".");
        seconds = parseFloat(secondParts[0] ?? "0");
        hundredths = parseFloat(secondParts[1] ?? "0");
      } else {
        seconds = parseFloat(timeParts[1] ?? "0");
      }
    }

    const timeInSeconds = (minutes * 60 + seconds + hundredths / 100) * slowdownFactor;
    return { time: timeInSeconds, text };
  });
};

export default function LyricsOverlay({ children }: QueuePanelProps) {
  const { areLyricsVisible, setLyricsVisible, setCurrentLyrics } = useContext(LyricsContext);
  const { song, currentTime, handleTimeChange, imageSrc } = usePlayer();
  const [lyrics, setLyrics] = useState<{ time: number; text: string }[]>([]);
  const [currentLyric, setCurrentLyric] = useState("");
  const [isSyncedLyrics, setIsSyncedLyrics] = useState(false);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const [scrollTimeoutID, setScrollTimeoutID] = useState<NodeJS.Timeout | null>(null);
  const [backgroundColour, setBackgroundColour] = useState("");
  const [noLyricMessage, setNoLyricMessage] = useState("");
  const { reverb } = useReverb()

  useEffect(() => {
    if (imageSrc) {
      const fac = new FastAverageColor();
      const getColor = async () => {
        const color = await fac.getColorAsync(imageSrc);
        setBackgroundColour(color.hex);
      };
      getColor();
    }
  }, [imageSrc]);

  useEffect(() => {
    if (!isUserScrolling && lyricsRef.current && currentLyricIndex >= 0) {
      const currentLyricElement = lyricsRef.current.querySelector(`:scope > div > p:nth-child(${currentLyricIndex + 1})`);
      if (currentLyricElement) {
        currentLyricElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [currentLyricIndex, isUserScrolling]);

  function handleScroll() {
    setIsUserScrolling(true);
    if (scrollTimeoutID) {
      clearTimeout(scrollTimeoutID);
    }
    setScrollTimeoutID(setTimeout(() => setIsUserScrolling(false), 100));
  }

  useEffect(() => {
    return () => {
      if (scrollTimeoutID) {
        clearTimeout(scrollTimeoutID);
      }
    };
  }, [scrollTimeoutID]);

  useEffect(() => {
    setLyrics([]);
    setCurrentLyric("");
    setCurrentLyricIndex(-1);
    setIsUserScrolling(false);
    setIsSyncedLyrics(false);
    setBackgroundColour("");

    const fetchLyrics = async () => {
      if (!song?.id) return;
    
      try {
        const fullSongInfo = await getSongInfo(song.id, false) as LibrarySong;
        if (!fullSongInfo?.name || !fullSongInfo?.artist || !fullSongInfo?.album_object?.name) {
          console.error('Missing required song information');
          setCurrentLyrics("");
          return;
        }
    
        const sanitizedSongName = fullSongInfo.name.replace(/\s*\(.*?\)\s*/g, '');
        const sanitizedAlbumName = fullSongInfo.album_object.name.replace(/\s*\(.*?\)\s*/g, '');
        const capitalizedArtistName = fullSongInfo.artist;
    
        const params = new URLSearchParams({
          track_name: sanitizedSongName,
          artist_name: capitalizedArtistName,
          album_name: sanitizedAlbumName,
        });
    
        const getResponse = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
        
        if (getResponse.ok) {
          const getData: LyricsObjectResponse = await getResponse.json();
          
          if (getData?.syncedLyrics) {
            setCurrentLyrics(getData.plainLyrics ?? "");
            const slowdownFactor = reverb ? 1 / 0.8 : 1;
            setLyrics(parseLyrics(getData.syncedLyrics, slowdownFactor));
            setIsSyncedLyrics(true);
            return;
          }
          
          if (getData?.plainLyrics) {
            const plainLyrics = getData.plainLyrics;
            
            const searchResponse = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
            
            if (searchResponse.ok) {
              const searchResults: LyricsObjectResponse[] = await searchResponse.json();
              
              const syncedResult = searchResults.find(result => result.syncedLyrics);
              
              if (syncedResult?.syncedLyrics) {
                setCurrentLyrics(syncedResult.plainLyrics ?? plainLyrics);
                const slowdownFactor = reverb ? 1 / 0.8 : 1;
                setLyrics(parseLyrics(syncedResult.syncedLyrics, slowdownFactor));
                setIsSyncedLyrics(true);
                return;
              }
            }
            
            setCurrentLyrics(plainLyrics);
            const slowdownFactor = reverb ? 1 / 0.8 : 1;
            setLyrics(parseLyrics(plainLyrics, slowdownFactor));
            setIsSyncedLyrics(false);
            return;
          }
        }
        
        const searchResponse = await fetch(`https://lrclib.net/api/search?${params.toString()}`);
        
        if (searchResponse.ok) {
          const searchResults: LyricsObjectResponse[] = await searchResponse.json();
          
          const bestResult = searchResults.find(result => result.syncedLyrics) || searchResults[0];
          
          if (bestResult) {
            setCurrentLyrics(bestResult.plainLyrics ?? "");
            const slowdownFactor = reverb ? 1 / 0.8 : 1;
            
            if (bestResult.syncedLyrics) {
              setLyrics(parseLyrics(bestResult.syncedLyrics, slowdownFactor));
              setIsSyncedLyrics(true);
            } else if (bestResult.plainLyrics) {
              setLyrics(parseLyrics(bestResult.plainLyrics, slowdownFactor));
              setIsSyncedLyrics(false);
            }
            return;
          }
        }
        
        setCurrentLyrics("");
        
      } catch (error) {
        console.error('Error fetching song info or lyrics:', error);
        setCurrentLyrics("");
      }
    };
    
    fetchLyrics();
  }, [song, setCurrentLyrics, reverb]);

  useEffect(() => {
    let animationFrameId: number;

    const updateLyric = () => {
      const currentSongTime = currentTime;
      const lineIndex = lyrics.findIndex((line, i) => {
        return (
          currentSongTime >= line.time &&
          (i + 1 === lyrics.length ||
            currentSongTime < (lyrics[i + 1]?.time ?? 0))
        );
      });

      if (lineIndex !== -1 && lyrics[lineIndex]?.text.length !== 0) {
        setCurrentLyric(lyrics[lineIndex]!.text);
        setCurrentLyricIndex(lineIndex);
      }

      animationFrameId = requestAnimationFrame(updateLyric);
    };

    updateLyric();

    return () => cancelAnimationFrame(animationFrameId);
  }, [lyrics, currentTime]);

  useEffect(() => {
    const noLyricMessages = [
      "Why do some songs have lyrics and others just have 'WOO!'s and 'YEAH!'s? It's like they're trying to confuse me on purpose",
      "Can someone please tell me where in the world of Google my favorite song's lyrics went? Did I accidentally delete the internet?",
      "I've got a master's degree in searching for lyrics, but somehow I still can't find this one...", 
      "I've given up on finding the lyrics for that song. I've started making up my own.",
      "If finding lyrics was an Olympic sport, I'd be a bronze medalist at best... but hey, at least I'm consistent!",
      "I've searched so hard for those lyrics that I think I might actually have a direct line to the songwriters' email... or maybe I just really need to get out more.",
      "I'm starting to think that songwriters have a secret pact to make their lyrics impossible to find... like some kind of lyrical Illuminati.",
      "What if the only way to get the lyrics is to become a professional detective and solve a series of music-themed mysteries?",
      "I've checked every website, app, and meme page... but it seems even Google can't find those lyrics for me... I'm starting to think they're hiding in a parallel universe.",
      "I've checked every fan site, forum, and Reddit thread... but it seems even the most dedicated fans don't know what those lyrics say... I'm starting to think it's a conspiracy.",
      "I've scrolled through so many tabs that I think my browser has started to auto-complete lyrics for me... or maybe it's just trying to get rid of me.",
      "What's the deal with songwriters not just putting up a 'Lyrics Unavailable' sign like normal people do? Do they think we're all just going to wing it and make up our own words?",
      "Thanks for nothing, Genius.com, for telling me that I need to 'try harder' to find those lyrics... like it's my fault your algorithm is broken or something",
      "I'm trying to 'Run the World' but it's hard when I can't even get the lyrics right... thanks, Genius.com, for nothing."
    ];
    const randomNoLyricMessage = noLyricMessages[Math.floor(Math.random() * noLyricMessages.length)] ?? "";
    setNoLyricMessage(randomNoLyricMessage)

  }, [areLyricsVisible])

  return areLyricsVisible ? (
    <>
    <Image className="bg-cover bg-center blur-3xl" alt={`${song.name} Cover`} width={1000} height={1000} src={imageSrc} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', filter: 'blur(96px) brightness(50%)' }} />
    <ScrollArea className="h-full overflow-x-hidden overflow-y-auto">
      <div
        onScroll={handleScroll}
        ref={lyricsRef}
        className="mb-32"
        >
        <div className="p-20">
          {lyrics.length > 0 ? (
            lyrics.map((line, index) => (
              <p
              key={index}
              className={`
                text-3xl 
                text-center 
                transition-opacity 
                duration-2000 
                text-white
                ${index === currentLyricIndex ? "opacity-100" : "opacity-50"} 
                ${index === currentLyricIndex ? "font-bold" : "font-normal"} 
                ${isSyncedLyrics && "cursor-pointer"} 
                `}
                onClick={
                  isSyncedLyrics ? () => handleTimeChange(line.time) : undefined
                }
              >
                {line.text}
              </p>
            ))
          ) : (
            <p className="flex justify-center items-center text-center text-6xl min-h-screen pb-40">
              {noLyricMessage}
            </p>
          )}
        </div>
      </div>
    </ScrollArea>
    </>
  ) : (
    children
  );
}