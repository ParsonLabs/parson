"use client";

import pl from "@/assets/pl-tp.png";
import { getServerInfo, isValid, refreshToken, setServerInfo, renewRefreshToken } from "@music/sdk";
import { deleteCookie, getCookie } from "cookies-next";
import { Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState, useCallback } from "react";
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

const REFRESH_KEY = 'plm_last_refresh';

const SplashScreen: React.FC<SplashScreenProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState("");
  const { push } = useRouter();
  const { session, setSession, isLoading } = useSession();

  const shouldRefreshToken = useCallback(() => {
    const lastRefresh = localStorage.getItem(REFRESH_KEY);
    const now = Date.now();

    if (!lastRefresh) {
      localStorage.setItem(REFRESH_KEY, now.toString());
      return true;
    }

    if (document.hidden) {
      localStorage.setItem(REFRESH_KEY, now.toString());
      return true;
    }

    return false;
  }, []);

  const handleServerCheck = useCallback(async () => {
    try {
      const info = await getServerInfo();
      if (!info) {
        setLoading(false);
        push("/");
        return false;
      }
      if (!info.startup_wizard_completed) {
        setLoading(false);
        push("/setup");
        return false;
      }
      return true;
    } catch (error) {
      console.error('Server check failed:', error);
      setLoading(false);
      push("/");
      return false;
    }
  }, [push]);
  
  const handleSession = useCallback(async () => {
    const accessToken = getCookie("plm_accessToken");

    if (shouldRefreshToken()) {
      try {
        await renewRefreshToken();
      } catch (error) {
        console.error('Failed to renew refresh token:', error);
      }
    }

    if (!accessToken) {
      try {
        const sessionRequest = await refreshToken();
        if (!sessionRequest.status || 
            sessionRequest.message === "Invalid token" || 
            sessionRequest.message === "Refresh token not found"
        ) {
          deleteCookie("plm_refreshToken");
          const serverInfo = await getServerInfo();
          if (!serverInfo) {
            setLoading(false)
            push("/")
            return;
          }
          push(serverInfo.startup_wizard_completed ? "/login" : "/setup");
          return;
        }
        const newSession = await getSession();
        setSession(newSession);
        push("/home");
      } catch (error) {
        push("/login");
      } finally {
        setLoading(false);
      }
      return;
    }

    const user = jwtDecode<DecodedToken>(accessToken.toString());
    try {
      const isValidResult = await isValid();
      if (!isValidResult.status) {
        deleteCookie("plm_refreshToken");
        deleteCookie("plm_accessToken");
        setSession(null);
        push("/login");
      }
    } catch {
      push("/login");
    } finally {
      setLoading(false);
    }

    if (user.exp * 1000 < Date.now()) {
      setLoading(false);
      deleteCookie("plm_accessToken");
      return;
    }

    try {
      // await refreshToken();
      // const newSession = await getSession();
      // if (newSession) {
      //   setSession(newSession);
      // }
    } catch (error) {
      console.error('Session refresh failed:', error);
    } finally {
      setLoading(false);
    }
  }, [push, shouldRefreshToken, setSession]);

  useEffect(() => {
    setPath(window.location.pathname);
    
    if (window.location.pathname.startsWith('/setup')) {
      setLoading(false);
      return;
    }

    const initializeApp = async () => {
      const serverOk = await handleServerCheck();
      if (serverOk) {
        await handleSession();
      }
    };

    initializeApp();
  }, [handleServerCheck, handleSession]);

  if (loading) {
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
}

export default SplashScreen;