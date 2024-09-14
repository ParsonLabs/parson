import getBaseURL from "@/lib/Server/getBaseURL";
import { User } from "@music/sdk/types";
import Image from "next/image";
import Link from "next/link";

type UserCardProps = {
  user: User;
};

export default function UserCard({ user }: UserCardProps) {
  const userIconURL = user.image ? `${getBaseURL()}/image/${encodeURIComponent(user.image)}` : "/snf.png";

  return (
    <Link href={`/user?id=${user.id}`}>
      <div className="w-44 h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Image width={256} height={256} src={userIconURL} alt={`${user.username} Image`} className="rounded-full" />
          <div className="flex flex-col items-center justify-center">
            <p className="font-bold text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={user.username}>
              {user.username}
            </p>
            {user.name && (
              <p className="text-white overflow-hidden overflow-ellipsis whitespace-nowrap" title={user.name}>
                {user.name}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}