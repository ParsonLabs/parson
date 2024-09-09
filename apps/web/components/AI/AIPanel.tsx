"use client";

import { useContext, useState, useEffect } from "react";
import { AIContext } from "./AIOverlayContext";
import { usePlayer } from "../Music/Player/usePlayer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@music/ui/components/resizable";
import { Ollama } from "ollama/browser";
import { LyricsContext } from "../Lyrics/LyricsOverlayContext";
import { ScrollArea } from "@music/ui/components/scroll-area";

type QueuePanelProps = {
  children: React.ReactNode;
};

function ChildrenComponent({ children }: QueuePanelProps) {
  return (
    <ResizablePanel defaultSize={100} className="!overflow-y-auto">
      {children}
    </ResizablePanel>
  );
}

export default function AIPanel({ children }: QueuePanelProps) {
  const { isAIVisible } = useContext(AIContext);
  const { currentLyrics } = useContext(LyricsContext);
  const { song, artist, album } = usePlayer();
  const [responseContent, setResponseContent] = useState("");

  useEffect(() => {
    const ollama = new Ollama({ host: process.env.NEXT_PUBLIC_AI_URL });
    setResponseContent("");
    ollama.abort();
    const fetchOllamaResponse = async () => {
      let releaseDate = new Date(album.first_release_date).toLocaleString(
        "default",
        { month: "long", year: "numeric" }
      );
      const responseStream = await ollama.chat({
        model: "llama3:8b-instruct-q8_0",
        messages: [
          {
            role: "user",
            content: `What is the song "${song.name}" by "${artist.name}" from the album: "${album.name}" released in ${releaseDate} about?\nHere are the lyrics: ${currentLyrics} `,
          },
        ],
        stream: true,
      });

      for await (const part of responseStream) {
        setResponseContent((prevContent) => prevContent + part.message.content);
      }
    };

    if (isAIVisible) {
      fetchOllamaResponse();
    }
  }, [
    isAIVisible,
    song,
    artist,
    currentLyrics,
    album.first_release_date,
    album.name,
  ]);

  return (
    <ResizablePanelGroup direction={"horizontal"}>
      <ChildrenComponent>{children}</ChildrenComponent>
      {isAIVisible && (
        <>
          <ResizableHandle />
          <ResizablePanel
            defaultSize={50}
            maxSize={70}
            minSize={20}
            className="shadow-lg border border-gray-200 p-4 sticky top-0"
          >
            <ScrollArea className="fixed w-96 h-full pt-14 pb-28">
              <div
                className="overflow-y-auto fixed"
                style={{
                  wordWrap: "break-word",
                  overflowWrap: "break-word",
                  maxHeight: "100%",
                  overflowY: "auto",
                }}
              >
                {responseContent}
              </div>
            </ScrollArea>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
