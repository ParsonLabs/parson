"use client"

import getSession from "@/lib/Authentication/JWT/getSession";
import { getFollowing, getNowPlaying, getSongInfo, getUserInfoById } from "@music/sdk";
import { Album, Artist, LibrarySong as Song, User } from "@music/sdk/types";
import { Avatar, AvatarFallback, AvatarImage } from "@music/ui/components/avatar";
import { Disc3Icon } from 'lucide-react';
import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfilePicture } from "@music/sdk";

type Friend = User & {
  nowPlaying: {
    artist: Artist,
    album: Album,
    song: Song,
  } | null,
  profilePicture: string | null
}

export default function FriendActivity() {
  const [friends, setFriends] = useState<Friend[]>([])

  useEffect(() => {
    const session = getSession();
    async function getActivity() {
      if (session) {
        const followingIDs = await getFollowing(Number(session?.sub) ?? "");
        const friends = await Promise.all(followingIDs.map(async (id: number) => {
          const friend = await getUserInfoById(id);
          const nowPlayingSongID = await getNowPlaying(id);
          const profilePicBlob = await getProfilePicture(id);
          const profilePicture = profilePicBlob ? URL.createObjectURL(profilePicBlob) : null;
          
          if (nowPlayingSongID) {
            const songResponse = await getSongInfo(String(nowPlayingSongID.now_playing) ?? 0);
            return {
              ...friend,
              nowPlaying: {
                artist: songResponse.artist_object,
                album: songResponse.album_object,
                song: songResponse,
              },
              profilePicture
            };
          } else {
            return {
              ...friend,
              nowPlaying: null,
              profilePicture
            };
          }
        }));
        
        setFriends(friends as any as Friend[]);
      }
    }
  
    getActivity();
  
    const intervalId = setInterval(getActivity, 5000);
  
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return friends && (
    <>
      {friends.length !== 0 && <h3 className="font-heading text-white font-semibold text-xl">Friend Activity</h3>}
      {friends.map((friend) => (
        <div key={friend.id} className="flex items-center">
          <Avatar className="cursor-pointer">
            {friend.profilePicture ? (
              <AvatarImage src={friend.profilePicture} alt="User Profile Picture" className="bg-gray-600" />
            ) : (
              <AvatarFallback>{friend.username?.substring(0, 2).toUpperCase()}</AvatarFallback>
            )}
          </Avatar>
          <div className="ml-4">
            <p className="text-sm">{friend.username}</p>
            {friend.nowPlaying && friend.nowPlaying.album &&
              <>
                <Link href={`/album?id=${friend.nowPlaying.album.id}`}><p className="text-sm">{friend.nowPlaying.song.name}</p></Link>
                {friend.nowPlaying.artist && <Link href={`/artist?id=${friend.nowPlaying.artist.id}`}><p className="text-sm">{friend.nowPlaying.artist.name}</p></Link>}
                <div className="flex flex-row items-center text-base">
                  <Disc3Icon className="mr-1" size={16} />
                  <Link href={`/album?id=${friend.nowPlaying.album.id}`}>
                    <p
                      className="truncate overflow-hidden whitespace-nowrap text-ellipsis"
                      title={friend.nowPlaying.album.name.length > 20 ? friend.nowPlaying.album.name : ''}
                    >
                      {friend.nowPlaying.album.name.length > 20
                        ? `${friend.nowPlaying.album.name.substring(0, 20)}...`
                        : friend.nowPlaying.album.name}
                    </p>
                  </Link>
                </div>
              </>
            }
          </div>
        </div>
      ))}
    </>
  )
}