"use client";

import { CommentInfo, getYouTubeComments, searchYouTube } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@music/ui/components/dialog";
import { ScrollArea } from "@music/ui/components/scroll-area";
import { Skeleton } from "@music/ui/components/skeleton";
import { MessageSquare, ThumbsUp, Music, X, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { usePlayer } from "./usePlayer";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@music/ui/lib/utils";

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


const formatTimeAgo = (text: string): string => {
  return text.replace("Edited ", "");
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
  const [videoTitle, setVideoTitle] = useState("");

  useEffect(() => {
    async function fetchComments() {
      if (!song || !artist || !isOpen) return;

      setIsLoading(true);
      setError("");

      try {
        const searchQuery = `${song} ${artist}`;
        const videos = await searchYouTube(searchQuery);

        if (videos.length > 0 && videos[0]?.id) {
          setVideoTitle(videos[0].title);
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

  return { comments, isLoading, error, videoTitle };
}

export default function ViewCommentsModal() {
  const { song, artist } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const { comments, isLoading, error, videoTitle } = useComments(
    song?.name,
    artist?.name,
    isOpen
  );
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative hover:bg-white/10 rounded-full transition-colors"
        >
          <MessageSquare className="h-5 w-5 text-gray-300" />
          {comments.commentCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-indigo-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
              {comments.commentCount > 99 ? "99+" : formatNumber(comments.commentCount)}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[520px] bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800/70 shadow-xl rounded-xl p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold text-white">
                Listener Comments
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-400 mt-1">
                From YouTube: {videoTitle || `${song?.name} by ${artist?.name}`}
              </DialogDescription>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="rounded-full h-8 w-8 border border-zinc-700/50 hover:bg-white/10"
              onClick={() => setIsOpen(false)}
            >
              <X className="h-4 w-4 text-gray-400" />
            </Button>
          </div>
        </DialogHeader>

        <div className="px-6 py-2 border-b border-zinc-800/50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400">
              {isLoading ? (
                "Loading comments..."
              ) : (
                <span>
                  {comments.commentCount > 0 
                    ? `${formatNumber(comments.commentCount)} comments` 
                    : "No comments available"}
                </span>
              )}
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-8 text-xs text-gray-400 hover:text-white flex gap-1.5 items-center"
              onClick={handleRefresh}
              disabled={isLoading || refreshing}
            >
              <RefreshCw className={cn(
                "h-3 w-3", 
                (isLoading || refreshing) && "animate-spin"
              )} />
              Refresh
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[60vh] px-6">
          <div className="py-4">
            {isLoading ? (
              <div className="space-y-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-9 w-9 rounded-full flex-shrink-0 bg-zinc-800" />
                    <div className="space-y-3 flex-1">
                      <div className="flex items-center justify-between">
                        <Skeleton className="h-4 w-[120px] bg-zinc-800" />
                        <Skeleton className="h-3 w-[80px] bg-zinc-800" />
                      </div>
                      <Skeleton className="h-16 w-full bg-zinc-800" />
                      <div className="flex gap-3">
                        <Skeleton className="h-3 w-[60px] bg-zinc-800" />
                        <Skeleton className="h-3 w-[40px] bg-zinc-800" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="bg-red-500/10 p-3 rounded-full mb-4">
                  <X className="h-6 w-6 text-red-400" />
                </div>
                <p className="text-red-400 font-medium">{error}</p>
                <p className="text-gray-500 text-sm mt-1 max-w-[300px]">
                  We couldn&apos;t load comments for this song. YouTube may have restricted access.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-4 border-zinc-700 text-gray-300 hover:bg-white/5"
                  onClick={handleRefresh}
                >
                  Try Again
                </Button>
              </div>
            ) : comments?.comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="bg-zinc-800/50 p-3 rounded-full mb-4">
                  <MessageSquare className="h-6 w-6 text-gray-500" />
                </div>
                <p className="text-gray-400 font-medium">No comments found</p>
                <p className="text-gray-500 text-sm mt-1 max-w-[300px]">
                  This song doesn&apos;t have any comments available on YouTube.
                </p>
              </div>
            ) : (
              <AnimatePresence>
                <div className="space-y-6">
                  {comments.comments.map((comment, index) => (
                    <motion.div 
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      className="pb-5 border-b border-zinc-800/50 last:border-0"
                    >
                      <div className="flex gap-3">
                        <div className="flex-shrink-0">
                          <div className="relative">
                            <Image
                              src={comment.authorThumbnails[0]?.url || "/snf.png"}
                              alt={comment.author}
                              width={36}
                              height={36}
                              className="rounded-full border border-zinc-700/50"
                              loading="lazy"
                            />
                            {comment.authorIsChannelOwner && (
                              <div className="absolute -bottom-1 -right-1 bg-indigo-500 rounded-full w-4 h-4 flex items-center justify-center">
                                <Music className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-1.5">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm text-white">
                                {comment.author}
                              </p>
                              {comment.isPinned && (
                                <span className="bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full text-[10px] font-medium">
                                  Pinned
                                </span>
                              )}
                              {comment.authorIsChannelOwner && (
                                <span className="bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full text-[10px] font-medium">
                                  Creator
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-gray-500">
                              {formatTimeAgo(comment.publishedText)}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-gray-300 whitespace-pre-wrap">
                            {comment.content}
                          </p>
                          <div className="flex items-center gap-4 mt-2.5">
                            <div className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer">
                              <ThumbsUp className="h-3.5 w-3.5" />
                              <span className="text-xs font-medium">
                                {formatNumber(comment.likeCount)}
                              </span>
                            </div>
                            {comment.replies && (
                              <div className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 transition-colors cursor-pointer">
                                <MessageSquare className="h-3.5 w-3.5" />
                                <span className="text-xs font-medium">
                                  {formatNumber(comment.replies.replyCount)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>
        
        <DialogFooter className="px-6 py-4 border-t border-zinc-800/50 bg-zinc-900/50">
          <div className="w-full flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Comments fetched from YouTube
            </p>
            <Button 
              size="sm" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => setIsOpen(false)}
            >
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}