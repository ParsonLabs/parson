"use client";

import pl from "@/assets/pl-tp.png";
import { isValid } from "@music/sdk";
import { deleteCookie } from "cookies-next";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useSession } from "../Providers/AuthProvider";

interface SplashScreenProps {
  children: React.ReactNode;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const { push } = useRouter();
  const { session, isLoading } = useSession();

  useEffect(() => {
    const checkServerUrl = async () => {
      if (isLoading) return;

      try {
        setLoading(true);

        const validationResult = await isValid();
        if (!validationResult.status) {
          deleteCookie('plm_refreshToken');
          deleteCookie('plm_accessToken');
          push('/login');
          return;
        }

        const storedServer = localStorage.getItem("server");
        const serverUrl = storedServer
          ? JSON.parse(storedServer).local_address
          : window.location.origin;

        const response = await fetch(`${serverUrl}/api/s/server/info`);

        if (!response.ok) {
          push("/");
          return;
        }

        const serverInfo = await response.json();
        if (!serverInfo.startup_wizard_completed) {
          push("/setup");
          return;
        }

        if (session?.username) {
          const currentPath = window.location.pathname;
          if (
            currentPath === "/" ||
            currentPath === "/login" ||
            currentPath === "/login/"
          ) {
            push("/home");
          }
          return;
        }

        const currentPath = window.location.pathname;
        if (currentPath !== "/login" && currentPath !== "/login/") {
          push("/login");
        }

      } catch (error) {
        console.error("Server check failed:", error);
        push("/");
      } finally {
        setLoading(false);
      }
    };

    checkServerUrl();
  }, [push, session, isLoading]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="flex items-center mb-4">
          <Image
            src={pl}
            alt="ParsonLabs Logo"
            width={64}
            height={64}
            className="mr-4"
          />
          <p className="text-6xl font-bold">ParsonLabs Music</p>
        </div>
        <Loader2Icon className="animate-spin w-12 h-12 mt-4" stroke="#4338ca" />
      </div>
    );
  }

  return <>{children}</>;
};

export default SplashScreen;