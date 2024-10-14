"use client"

import pl from '@/assets/pl-tp.png';
import { Loader2Icon } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useSession } from '../Providers/AuthProvider';

interface SplashScreenProps {
  children: React.ReactNode;
}

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
        if (session?.username) {
          const currentPath = window.location.pathname;
          const queryParams = window.location.search;
          if (currentPath === "/" || currentPath === "/login" || currentPath === "/login/") {
            push("/home");
          } else {
            push(`${currentPath}${queryParams}`);
          }

          setLoading(false);
        } else {
          push("/login");
          setLoading(false);
        }
      } else {
        push("/")
        setLoading(false);
      }
    };
  
    checkServerUrl();
  }, [push, session]);

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