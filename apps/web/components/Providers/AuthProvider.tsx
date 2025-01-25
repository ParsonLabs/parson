"use client"

import { ReactNode, createContext, useState, useContext, useEffect } from 'react';
import getSession, { type ExtendedJWTPayload } from '@/lib/Authentication/JWT/getSession';
import { isValid } from '@music/sdk';
import { deleteCookie } from 'cookies-next';

interface AuthContextType {
  session: ExtendedJWTPayload | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  refreshSession: async () => {}
});

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ExtendedJWTPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refreshSession = async () => {
    try {
      setIsLoading(true);
      
      const validationResult = await isValid();
      if (!validationResult.status) {
        setSession(null);
        deleteCookie('plm_accessToken');
        deleteCookie('plm_refreshToken');
        return;
      }

      const newSession = await getSession();
      if (!newSession) {
        setSession(null);
        return;
      }

      const now = Date.now() / 1000;
      if (newSession.exp && newSession.exp < now) {
        setSession(null);
        deleteCookie('plm_accessToken');
        deleteCookie('plm_refreshToken');
        return;
      }

      setSession(newSession);
      setLastRefresh(new Date());
      
    } catch (error) {
      console.error('Session refresh failed:', error);
      setSession(null);
      deleteCookie('plm_accessToken');
      deleteCookie('plm_refreshToken');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initSession = async () => {
      if (mounted) {
        await refreshSession();
      }
    };

    initSession();
    
    const refreshInterval = setInterval(refreshSession, 5 * 60 * 1000);
    
    return () => {
      mounted = false;
      clearInterval(refreshInterval);
    };
  }, []);

  return (
    <AuthContext.Provider 
      value={{
        session,
        isLoading,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useSession() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useSession must be used within an AuthProvider");
  }
  return context;
}