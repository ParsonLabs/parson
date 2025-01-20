"use client"

import { getServerInfo, setServerInfo } from "@music/sdk";
import { Button } from "@music/ui/components/button";
import { useRouter } from "next/navigation";

export default function Setup() {
  const router = useRouter()

  async function completeStartupWizard() {
    const serverInfo = await getServerInfo();
    await setServerInfo(
      serverInfo.local_address,
      serverInfo.server_name,
      serverInfo.version,
      serverInfo.version,
      true,
      serverInfo.login_disclaimer
    );

    router.push("/home")
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <p className="text text-center text-4xl py-14 text-white">Setup Completed!</p>
      <div className="flex flex-col items-center justify-center">
        <Button
          onClick={completeStartupWizard}
          className="w-full px-6 py-4 mt-6 text-lg text-white bg-indigo-800 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
          See your Music
        </Button>
      </div>
    </div>
  );
}