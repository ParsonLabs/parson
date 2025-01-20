"use client";

import pl from "@/assets/pl-tp.png";
import { isValid } from "@music/sdk";
import { deleteCookie, getCookie } from "cookies-next";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useSession } from "../Providers/AuthProvider";
import { jwtDecode } from "jwt-decode";

interface SplashScreenProps {
  children: React.ReactNode;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { push } = useRouter();
  const { session, isLoading } = useSession();

  const refreshTokens = async () => {
    try {
      setIsRefreshing(true);
      const response = await fetch(`${window.location.origin}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (response.ok) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const validationResult = await isValid();
        return validationResult.status;
      }
      return false;
    } catch (error) {
      console.error("Token refresh failed:", error);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const checkTokenAndServer = async () => {
      if (isLoading) return;

      try {
        setLoading(true);
        const refreshToken = getCookie('plm_refreshToken');
        const accessToken = getCookie('plm_accessToken');

        if (refreshToken && !accessToken) {
          const refreshSuccessful = await refreshTokens();
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const newAccessToken = getCookie('plm_accessToken');
          if (refreshSuccessful && newAccessToken) {
            await checkServer();
            return;
          }
        }

        if (refreshToken && accessToken) {
          try {
            const decoded = jwtDecode(accessToken.toString());
            const currentTime = Math.floor(Date.now() / 1000);
            
            if (decoded.exp && decoded.exp < currentTime) {
              const refreshSuccessful = await refreshTokens();
              if (refreshSuccessful) {
                await checkServer();
                return;
              }
            } else {
              await checkServer();
              return;
            }
          } catch (error) {
            console.error("Token validation failed:", error);
          }
        }

        if (!isRefreshing) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Delay before redirect
          push('/login');
        }
      } catch (error) {
        console.error("Server check failed:", error);
        push("/");
      } finally {
        setLoading(false);
      }
    };

    const checkServer = async () => {
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
        if (currentPath === "/" || currentPath === "/login" || currentPath === "/login/") {
          push("/home");
        }
      }
    };

    checkTokenAndServer();
  }, [push, session, isLoading]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white">
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