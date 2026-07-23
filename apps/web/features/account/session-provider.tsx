"use client";

import type { SessionResponse } from "@parson/music-sdk";
import { createContext, useContext, useState, type ReactNode } from "react";

type Session = NonNullable<SessionResponse["claims"]>;

interface SessionContextValue {
  librarySetupPending: boolean;
  session: Session | null;
  setLibrarySetupPending: (pending: boolean) => void;
  setSession: (session: Session | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export default function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [librarySetupPending, setLibrarySetupPending] = useState(false);

  return (
    <SessionContext.Provider
      value={{
        librarySetupPending,
        session,
        setLibrarySetupPending,
        setSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context)
    throw new Error("useSession must be used within SessionProvider");
  return context;
}
