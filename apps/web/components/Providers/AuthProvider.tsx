"use client"

import { ReactNode, createContext, useState, useContext, useEffect } from 'react';
import getSession, { type ExtendedJWTPayload } from '@/lib/Authentication/JWT/getSession';

interface AuthContextType {
  session: ExtendedJWTPayload | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ExtendedJWTPayload | null>(null);

  useEffect(() => {
    const session = getSession();
    setSession(session);
  }, []);

  return (
    <AuthContext.Provider value={{ session }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useSession() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useSession must be used within an AuthProvider");
  }
  return context;
}