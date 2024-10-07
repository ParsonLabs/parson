"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Avatar, AvatarFallback } from "@music/ui/components/avatar";
import { getFollowers, getFollowing, getUserInfoById } from "@music/sdk";
import getSession from "@/lib/Authentication/JWT/getSession";
import FollowButton from "@/components/Friends/FollowButton";
import ArtistCard from "@/components/Music/Artist/ArtistCard";
import { User } from "@music/sdk/types";
import UserCard from "@/components/Music/Card/User/UserCard";
import { useSession } from "@/components/Providers/AuthProvider";

export default function SocialPage() {
  const { session } = useSession()
  const id = session?.sub;

  const [followers, setFollowers] = useState<User[]>([]);
  const [following, setFollowing] = useState<User[]>([]);
  const [userInfo, setUserInfo] = useState<any>(null);

  useEffect(() => {
    async function fetchData() {
      if (!id) return;

      const followersData = await getFollowers(Number(id));
      const followingData = await getFollowing(Number(id));

      const userInfoPromises = [
        ...followersData.map((follower: any) => getUserInfoById(follower.id)),
        ...followingData.map((follow: any) => getUserInfoById(follow.id)),
      ];

      const userInfoResults = await Promise.all(userInfoPromises);

      const followersInfo = userInfoResults.slice(0, followersData.length);
      const followingInfo = userInfoResults.slice(followersData.length);

      setFollowers(followersInfo);
      setFollowing(followingInfo);

      const userInfo = await getUserInfoById(Number(id));
      setUserInfo(userInfo);
    }

    fetchData();
  }, [id]);

  if (!userInfo) {
    return null;
  }

  const noFollowersOrFollowing = followers.length === 0 && following.length === 0;

  return (
    <div className="text-center min-h-screen">
      <div className="flex items-center space-x-4 pt-32 justify-center">
        {userInfo.image ? (
          <Image src={userInfo.image} alt="" className="w-32 h-32 rounded-full" />
        ) : (
          <Avatar className="w-32 h-32">
            <AvatarFallback className="text-4xl">
              {userInfo.username.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex flex-col">
          <p className="text-lg">@{userInfo.username}</p>
          {userInfo.username !== session?.username && (
            <FollowButton userIDToFollow={userInfo.id} />
          )}
        </div>
      </div>

      {noFollowersOrFollowing ? (
        <h1 className="pt-14 font-bold text-base md:text-2xl lg:text-3xl mr-5">You are not following anyone!</h1>
      ) : (
        <>
          <div>
            <h2 className="text-xl font-bold">Followers</h2>
            <div className="flex flex-row flex-wrap justify-center">
              {followers.map((follower, index) => (
                <div className="mr-20 mb-4" key={index}>
                  <UserCard user={follower} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold">Following</h2>
            <div className="flex flex-row flex-wrap justify-center">
              {following.map((follow, index) => (
                <div className="mr-20 mb-4" key={index}>
                  <UserCard user={follow} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}