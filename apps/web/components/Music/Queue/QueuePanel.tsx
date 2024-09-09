"use client"

import getBaseURL from "@/lib/Server/getBaseURL";

import { Album, Artist, LibrarySong } from "@music/sdk/types";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@music/ui/components/resizable";
import { Separator } from "@music/ui/components/separator";
import Image from "next/image";
import Link from "next/link";
import { useContext, useEffect, useState } from "react";
import { usePlayer } from "../Player/usePlayer";
import { PanelContext } from "./QueuePanelContext";

type QueuePanelProps = {
  children: React.ReactNode
}

function ChildrenComponent({ children }: QueuePanelProps) {
  return (
    <ResizablePanel defaultSize={100} className="!overflow-y-auto">{children}</ResizablePanel>
  )
}

export default function QueuePanel({ children }: QueuePanelProps) {
  const { isPanelVisible } = useContext(PanelContext);

  const { queue } = usePlayer()

  return (
    <ResizablePanelGroup direction={"horizontal"}>
      <ChildrenComponent>{children}</ChildrenComponent>
      {isPanelVisible && (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={30} maxSize={30} minSize={20}>
            {queue && queue.map(queueItem => {
              return (
                <QueueItem queueItem={queueItem} key={queueItem.song.id}/>
              ); 
            })}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

type Queue = {
  queueItem: {
    song: LibrarySong
    artist: Artist,
    album: Album
  }
}

function QueueItem({ queueItem }: Queue) {
  const [imageSrc, setImageSrc] = useState("")

  useEffect(() => {
    setImageSrc(`${getBaseURL()}/image/${encodeURIComponent(queueItem.album.cover_url)}`)
  }, [queueItem.album.cover_url])

  const { song, artist, album } = queueItem

  return (
    <>
    <div className="flex items-center">
      <Image src={imageSrc} width={64} height={64} alt={song.name + " Image"} className="rounded h-10 w-10"/>
      <div className="ml-4">
        <Link href={`/album?id=${album.id}`}><p>{song.name}</p></Link>
        <Link href={`/artist?id=${artist.id}`}><p>{artist.name}</p></Link>
      </div>
    </div>
  <Separator className="my-2 bg-gray-700"/>
  </>
  )
}
