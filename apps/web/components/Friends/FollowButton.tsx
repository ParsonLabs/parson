"use client"

import getSession from "@/lib/Authentication/JWT/getSession"
import { follow } from "@music/sdk"
import { Button } from "@music/ui/components/button"

type FollowButtonProps = {
  userIDToFollow: number 
}

export default function FollowButton({ userIDToFollow }: FollowButtonProps) {
  const session = getSession()

  return session && <Button onClick={() => follow(Number(session.sub), userIDToFollow)}>Follow</Button>
}