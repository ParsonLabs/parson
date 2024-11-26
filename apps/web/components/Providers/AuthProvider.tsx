"use client"

import { ReactNode, createContext, useState, useContext, useEffect } from 'react';
import getSession, { type ExtendedJWTPayload } from '@/lib/Authentication/JWT/getSession';

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

  const refreshSession = async () => {
    try {
      setIsLoading(true);
      const newSession = await Promise.resolve(getSession());
      setSession(newSession);
    } catch (error) {
      console.error('Failed to refresh session:', error);
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
    
    const refreshInterval = setInterval(refreshSession, 5 * 60 * 1000);
    return () => clearInterval(refreshInterval);
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