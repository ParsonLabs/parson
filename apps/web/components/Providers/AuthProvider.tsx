"use client"

import { ReactNode, createContext, useState, useContext, useEffect } from 'react';
import getSession, { type ExtendedJWTPayload } from '@/lib/Authentication/JWT/getSession';
import { useRouter } from 'next/navigation';
import { getCookie } from 'cookies-next';

interface AuthContextType {
  session: ExtendedJWTPayload | null;
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  setSession: (session: ExtendedJWTPayload | null) => void;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  isLoading: true,
  refreshSession: async () => {},
  setSession: () => {}
});

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ExtendedJWTPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { push } = useRouter();

  const refreshSession = async () => {
    try {
      setIsLoading(true);
      const newSession = await getSession();
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
  }, []);
  
  return (
    <AuthContext.Provider 
      value={{
        session,
        isLoading,
        refreshSession,
        setSession
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