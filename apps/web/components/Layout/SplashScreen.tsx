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
import { motion, AnimatePresence } from "framer-motion";

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
  const [loadingStage, setLoadingStage] = useState('server'); // 'server', 'auth', 'finalizing'
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
      setLoadingStage('auth');
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
            setLoading(false);
            push("/");
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
        setLoadingStage('finalizing');
        setTimeout(() => setLoading(false), 800);
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
      setLoadingStage('finalizing');
      setTimeout(() => setLoading(false), 800);
    }

    if (user.exp * 1000 < Date.now()) {
      setLoading(false);
      deleteCookie("plm_accessToken");
      return;
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

  const loadingMessages = {
    'server': 'Connecting to server...',
    'auth': 'Authenticating...',
    'finalizing': 'Preparing your music...'
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 text-white">
        <div className="relative w-full max-w-md">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-40 w-full flex justify-center gap-1 opacity-20">
            {[...Array(24)].map((_, i) => (
              <motion.div
                key={i}
                animate={{
                  height: [20, 30 + Math.random() * 50, 20],
                }}
                transition={{
                  duration: 1.2 + Math.random() * 0.8,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
                className="w-1 bg-purple-300 rounded-full"
              />
            ))}
          </div>
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-zinc-900/40 backdrop-blur-lg p-8 rounded-2xl border border-zinc-800/50 shadow-2xl flex flex-col items-center justify-center relative overflow-hidden"
          >
            <div className="absolute inset-0 z-0 opacity-10">
              <div className="absolute inset-0 bg-gradient-to-tr from-indigo-600 via-purple-500 to-pink-500 opacity-50"></div>
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-violet-500"></div>
            </div>
            
            <div className="relative z-10 flex flex-col items-center">
              <motion.div 
                className="flex flex-col items-center mb-8"
                animate={{ scale: [0.98, 1.01, 0.98] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <div className="rounded-full p-3 bg-indigo-500/10 mb-4">
                  <Image 
                    src={pl} 
                    alt="ParsonLabs Logo" 
                    width={80} 
                    height={80} 
                    className="rounded-full shadow-lg" 
                  />
                </div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-purple-200 bg-clip-text text-transparent mb-1">
                  ParsonLabs Music
                </h1>
                <p className="text-sm text-zinc-400">Own Your Music</p>
              </motion.div>
              
              <div className="w-full max-w-xs mb-6">
                <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
                    animate={{ 
                      width: ["0%", "100%"],
                      x: ["-100%", "0%"]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Loader2Icon className="animate-spin w-5 h-5 text-indigo-400" />
                  <motion.div 
                    className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-indigo-500"
                    animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                </div>
                
                <AnimatePresence mode="wait">
                  <motion.p
                    key={loadingStage}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="text-sm text-zinc-300 font-medium"
                  >
                    {loadingMessages[loadingStage as keyof typeof loadingMessages]}
                  </motion.p>
                </AnimatePresence>
                
                <div className="flex">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        delay: i * 0.2,
                      }}
                      className="text-indigo-400"
                    >
                      .
                    </motion.span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
          
          <div className="absolute -bottom-16 right-0 opacity-20">
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ 
                  opacity: 0.3, 
                  x: 20 * i, 
                  y: -10 * i,
                  rotate: 10 * i
                }}
                animate={{
                  y: [0, -15, 0],
                  rotate: [0, 10, 0]
                }}
                transition={{
                  duration: 3 + i,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                  delay: i * 0.3
                }}
                className="absolute text-2xl text-indigo-300"
              >
                ♪
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SplashScreen;