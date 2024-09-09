"use client"

import getSession from "@/lib/Authentication/JWT/getSession"
import { createPlaylist } from "@music/sdk"
import { Button } from "@music/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@music/ui/components/dialog"
import { Input } from "@music/ui/components/input"
import { Label } from "@music/ui/components/label"
import { Loader2 } from "lucide-react"
import { useState, useTransition } from "react"

type CreatePlaylistDialog = {
  children: React.ReactNode
}

export default function CreatePlaylistDialog({ children }: CreatePlaylistDialog) {
  const [playlistName, setPlaylistName] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [isPending, startTransition] = useTransition()

  const session = getSession()
  const username = session?.username

  const open = () => setOpenDialog(true)
  const close = () => setOpenDialog(false)

  return (
    <Dialog open={openDialog} onOpenChange={() => setOpenDialog(!openDialog)}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Playlist</DialogTitle>
          <DialogDescription>
            Enter the playlist name to organise your music library.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              placeholder="Shaolin Temple"
              value={playlistName}
              onChange={e => setPlaylistName(e.target.value)}
              className="col-span-3"
              />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={isPending} onClick={() => createPlaylist(Number(session?.sub), playlistName).then(close)}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
            Create Playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
