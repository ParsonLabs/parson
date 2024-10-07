"use client"

import pl from '@/assets/pl-tp.png';
import getSession from '@/lib/Authentication/JWT/getSession';
import { Loader2Icon } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useSession } from '../Providers/AuthProvider';

interface SplashScreenProps {
  children: React.ReactNode;
}

const setItemWithExpiry = (key: string, value: string, ttl: number) => {
  const now = new Date();
  const item = {
    value: value,
    expiry: now.getTime() + ttl,
  };
  localStorage.setItem(key, JSON.stringify(item));
};

const getItemWithExpiry = (key: string) => {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) {
    return null;
  }
  const item = JSON.parse(itemStr);
  const now = new Date();
  if (now.getTime() > item.expiry) {
    localStorage.removeItem(key);
    return null;
  }
  return item.value;
};

const SplashScreen: React.FC<SplashScreenProps> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const { push } = useRouter();
  const { session } = useSession()

  useEffect(() => {
    const checkServerUrl = async () => {
      const storedServer = localStorage.getItem("server");
      const response = await fetch(
        `${storedServer && JSON.parse(storedServer).local_address || window.location.origin}/api/s/server/info`
      );
  
      if (response.ok) {
        if (session) {
          const currentPath = window.location.pathname;
          const queryParams = window.location.search;
          if (currentPath === "/") {
            push("/home");
          } else {
            push(`${currentPath}${queryParams}`);
          }

          setLoading(false);
          setItemWithExpiry("loading", "false", 3600000);
        } else {
          push("/login");
          setLoading(false);
          setItemWithExpiry("loading", "false", 3600000);
        }
      } else {
        push("/")
        setLoading(false);
        setItemWithExpiry("loading", "false", 3600000);
      }
    };
  
    checkServerUrl();
  }, [push, session]);

  useEffect(() => {
    const storedLoading = getItemWithExpiry("loading");
    if (storedLoading === "false") {
      setLoading(false);
      return;
    }
    
  }, [push]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
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