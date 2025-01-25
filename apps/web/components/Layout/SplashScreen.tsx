"use client";

import pl from "@/assets/pl-tp.png";
import { isValid, refreshToken } from "@music/sdk";
import { deleteCookie, getCookie } from "cookies-next";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import { useSession } from "../Providers/AuthProvider";
import { jwtDecode } from "jwt-decode";
import getSession from "@/lib/Authentication/JWT/getSession";

interface SplashScreenProps {
  children: React.ReactNode;
}

interface DecodedToken {
  exp: number;
  sub: string;
  username: string;
  bitrate: number;
  token_type: string;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [serverChecked, setServerChecked] = useState(false);
  const [tokensReady, setTokensReady] = useState(false);
  const { push } = useRouter();
  const { session, isLoading, refreshSession } = useSession();

  const protectedRoutes = ['/home', '/library', '/settings'];
  const publicRoutes = ['/', '/login', '/setup'];

  const refreshTokens = async () => {
    try {
      setIsRefreshing(true);
      const result = await refreshToken();
      if (result.status) {
        await refreshSession();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Token refresh failed:", error);
      return false;
    } finally {
      setIsRefreshing(false);
    }
  };

  const checkServerStatus = async () => {
    try {
      const storedServer = localStorage.getItem("server");
      const serverUrl = storedServer
        ? JSON.parse(storedServer).local_address
        : window.location.origin;

      const response = await fetch(`${serverUrl}/api/s/server/info`);
      const serverInfo = await response.json();

      if (!response.ok) {
        push("/");
        return false;
      }

      if (!serverInfo.startup_wizard_completed) {
        push("/setup");
        return false;
      }

      setServerChecked(true);
      return true;
    } catch (error) {
      console.error("Server check failed:", error);
      push("/");
      return false;
    }
  };

  const validateTokens = async (currentPath: string): Promise<boolean> => {
    const accessToken = getCookie('plm_accessToken');
    if (!accessToken) {
      const refreshSuccessful = await refreshTokens();
      return refreshSuccessful;
    }
  
    try {
      const decodedToken = jwtDecode<DecodedToken>(accessToken as string);
      const expirationTime = decodedToken.exp * 1000;
      const currentTime = Date.now();
  
      if (expirationTime <= currentTime) {
        return await refreshTokens();
      }
  
      const validationResult = await isValid();
      if (!validationResult.status) {
        return await refreshTokens();
      }
      
      return true;
    } catch (error) {
      console.error("Token validation failed:", error);
      return await refreshTokens();
    }
  };

  const validateAndRefresh = async () => {
    if (isLoading || isRefreshing) return;

    try {
      const currentPath = window.location.pathname;
      
      const serverStatus = await checkServerStatus();
      if (!serverStatus) {
        setLoading(false);
        return;
      }

      const isValid = await validateTokens(currentPath);
      
      if (isValid) {
        await refreshSession();
        const sessionData = await getSession();
        
        if (sessionData) {
          setTokensReady(true);
          if (currentPath === '/' || currentPath === '/login') {
            push('/home');
          }
        }
      } else {
        deleteCookie('plm_refreshToken');
        deleteCookie('plm_accessToken');
        if (!publicRoutes.includes(currentPath)) {
          push('/login');
        }
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      push('/');
    } finally {
      setAuthChecked(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    if (mounted && (!authChecked || !tokensReady)) {
      validateAndRefresh();
    }

    return () => {
      mounted = false;
    };
  }, [authChecked, serverChecked, isLoading, tokensReady]);

  if (loading || !tokensReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white">
        <div className="flex items-center mb-4">
          <Image src={pl} alt="ParsonLabs Logo" width={64} height={64} className="mr-4" />
          <p className="text-6xl font-bold">ParsonLabs Music</p>
        </div>
        <Loader2Icon className="animate-spin w-12 h-12 mt-4" stroke="#4338ca" />
      </div>
    );
  }

  return <>{children}</>;
};

export default SplashScreen;