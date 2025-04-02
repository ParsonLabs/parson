"use client"

import { useSession } from "@/components/Providers/AuthProvider"
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
import { useQueryClient } from "@tanstack/react-query"

type CreatePlaylistDialog = {
  children: React.ReactNode
}

export default function CreatePlaylistDialog({ children }: CreatePlaylistDialog) {
  const [playlistName, setPlaylistName] = useState("")
  const [openDialog, setOpenDialog] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { session } = useSession()
  const queryClient = useQueryClient()

  const username = session?.username

  const open = () => setOpenDialog(true)
  const close = () => setOpenDialog(false)

  const handleCreatePlaylist = async () => {
    if (!playlistName.trim() || !session?.sub) return
    
    startTransition(async () => {
      try {
        await createPlaylist(Number(session.sub), playlistName)
        queryClient.invalidateQueries({ queryKey: ['userPlaylists', session.sub] })
        setPlaylistName("")
        close()
      } catch (error) {
        console.error("Failed to create playlist:", error)
      }
    })
  }

  return (
    <Dialog open={openDialog} onOpenChange={setOpenDialog}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-zinc-900 border border-zinc-800 shadow-xl rounded-lg transition-all duration-200">
        <DialogHeader className="space-y-3 pb-4">
          <DialogTitle className="text-2xl font-bold text-white">
            Create Playlist
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-sm">
            Enter the playlist name to organise your music library.
          </DialogDescription>
        </DialogHeader>
        <div className="py-6">
          <div className="flex flex-col space-y-2">
            <Label htmlFor="name" className="text-sm font-medium text-zinc-300">
              Playlist Name
            </Label>
            <Input
              id="name"
              placeholder="Shaolin Temple"
              value={playlistName}
              onChange={e => setPlaylistName(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500 
                focus:ring-2 focus:ring-purple-500 focus:border-transparent
                transition-all duration-200"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && playlistName.trim() && !isPending) {
                  handleCreatePlaylist();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter className="pt-4 border-t border-zinc-800">
          <Button
            type="submit"
            disabled={isPending || !playlistName.trim()}
            onClick={handleCreatePlaylist}
            className="bg-purple-600 hover:bg-purple-700 text-white font-medium
              px-6 py-2 rounded-md transition-colors duration-200
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
            ) : null}
            Create Playlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}