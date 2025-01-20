import { setServerInfo } from "@music/sdk";
import { ServerInfo } from "@music/sdk/types";
import { deleteCookie } from "cookies-next";
import { Server } from "lucide-react";
import { useRouter } from "next/navigation";
import { decode } from "punycode";
import { useEffect, useState } from "react";

export default function ServerSelectIcon() {
  const router = useRouter();
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const storedServer = localStorage.getItem("server");
    if (storedServer) {
      setServer(JSON.parse(storedServer));
    }
  }, []);

  const handleConnect = async () => {
    if (server) {
      try {
        const response = await fetch(`${server.local_address}/api/s/server/info`);
        if (response.status === 204) {
          router.push("/setup");
        } else if (response.ok) {
          const serverInfo: ServerInfo = await response.json();
          if (serverInfo.product_name && serverInfo.startup_wizard_completed) {
            setServerInfo(serverInfo.local_address, serverInfo.server_name, serverInfo.version, serverInfo.product_name, serverInfo.startup_wizard_completed, serverInfo.login_disclaimer)
            router.push("/home");
          } else {
            setErrorMessage("Server is not properly configured.");
          }
        } else {
          setErrorMessage("Failed to connect to the server. Is it running?");
        }
      } catch (error) {
        setErrorMessage("Error connecting to the server. Is it running?");
      }
    }
  };

  const handleDelete = () => {
    localStorage.removeItem("server");
    deleteCookie("server");
    router.refresh()
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white">
      <Server className="w-16 h-16 mb-4" />
      <p className="text-xl mb-4">{server?.server_name || server?.product_name || "ParsonLabs Music"}</p>
      <p className="text-sm text-gray-400 mb-4">{server?.local_address}</p>
      <div className="flex space-x-4">
        <button
          onClick={handleConnect}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Connect
        </button>
        <button
          onClick={handleDelete}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Delete
        </button>
      </div>
      {errorMessage && (
        <p className="mt-4 text-red-500">{errorMessage}</p>
      )}
    </div>
  );
}