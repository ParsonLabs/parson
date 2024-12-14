"use client";

import { CommentInfo, getYouTubeComments, searchYouTube } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@music/ui/components/dialog";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { Skeleton } from "@music/ui/components/skeleton";
import { MessageSquare, ThumbsUp } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePlayer } from "./usePlayer";

const formatNumber = (num: number): string => {
  if (num === 0) return '0';
  if (num < 0) return `-${formatNumber(-num)}`;
  
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

function useComments(
  song: string | undefined,
  artist: string | undefined,
  isOpen: boolean
) {
  const [comments, setComments] = useState<CommentInfo>({
    commentCount: 0,
    videoId: "",
    comments: [],
    continuation: ""
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchComments() {
      if (!song || !artist || !isOpen) return;

      setIsLoading(true);
      setError("");

      try {
        const searchQuery = `${song} ${artist}`;
        const videos = await searchYouTube(searchQuery);

        if (videos.length > 0 && videos[0]?.id) {
          const comments = await getYouTubeComments(videos[0].id);
          setComments(comments);
        }
      } catch (err) {
        setError("Comments could not be loaded");
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchComments();
  }, [song, artist, isOpen]);

  return { comments, isLoading, error };
}

export default function ViewCommentsModal() {
  const { song } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const { comments, isLoading, error } = useComments(
    song?.name,
    song?.artist,
    isOpen
  );

  return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <MessageSquare className="h-5 w-5 text-gray-300" />
          </Button>
        </DialogTrigger>
  
        <DialogContent className="sm:max-w-[500px] bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-100">
              Comments for {song?.name}
            </DialogTitle>
          </DialogHeader>
  
          <ScrollArea className="h-[60vh] pr-4">
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-[100px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                      <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                    </div>
                    <Skeleton className="h-16 w-full bg-zinc-800" />
                    <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                    <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                    <Skeleton className="h-4 w-[60px] bg-zinc-800" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <p className="text-red-400 text-center py-4">{error}</p>
            ) : comments?.comments.length === 0 ? (
              <p className="text-gray-400 text-center py-4">
                No comments found
              </p>
            ) : (
              <div className="space-y-6">
                {comments.comments.map((comment, index) => (
                  <div key={index} className="pb-4 border-b border-zinc-800 last:border-0">
                    <div className="flex items-start gap-3">
                      <Image
                        src={comment.authorThumbnails[0]?.url || "snf.png"}
                        alt={""}
                        width={50}
                        height={50}
                        className="w-8 h-8 rounded-full"
                        loading="lazy"
                      />
                      <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-gray-100">
                              {comment.author}
                            </p>
                            {comment.isPinned && (
                              <span className="bg-zinc-800 px-2 py-0.5 rounded text-xs text-gray-300">
                                Pinned
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 cursor-pointer">
                            {comment.publishedText}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed text-gray-300">
                          {comment.content}
                        </p>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-1.5">
                            <ThumbsUp className="h-3.5 w-3.5 text-gray-400" />
                            <span className="text-xs text-gray-400">
                              {formatNumber(comment.likeCount)}
                            </span>
                          </div>
                          {comment.replies && (
                            <div className="flex items-center gap-1.5">
                              <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
                              <span className="text-xs text-gray-400">
                                {comment.replies.replyCount}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
}
