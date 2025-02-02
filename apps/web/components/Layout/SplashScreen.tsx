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
  const { push } = useRouter();
  const { session, setSession, isLoading } = useSession();

  useEffect(() => {
    async function checkSession() {
      const accessToken = getCookie("plm_accessToken");

      if (!accessToken) {
        try {
          const sessionRequest = await refreshToken();
      
          if (!sessionRequest.status || 
              sessionRequest.message === "Invalid token" || 
              sessionRequest.message === "Refresh token not found"
          ) {
            deleteCookie("plm_refreshToken");
            push("/login");
          } else {
            const newSession = await getSession();
            setSession(newSession);
            push("/home");
          }
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
          deleteCookie("plm_accessToken");
          deleteCookie("plm_refreshToken");
          setSession(null);
          push("/login");
        } else {
        }
      } catch (error) {
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
        await refreshToken();
        const newSession = await getSession();
        if (newSession) {
          setLoading(false);
          return;
        }
      } catch (error) {
        setLoading(false);
        return;
      }
    }

    checkSession();
  })

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
};

export default SplashScreen;