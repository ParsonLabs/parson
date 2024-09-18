"use client"

import { createContext, useContext, useState, ReactNode } from "react";

interface SlowedReverbContextProps {
  reverb: boolean;
  setReverb: (value: boolean) => void;
}

const SlowedReverbContext = createContext<SlowedReverbContextProps | undefined>(undefined);

export const SlowedReverbProvider = ({ children }: { children: ReactNode }) => {
  const [reverb, setReverb] = useState(false);

  return (
    <SlowedReverbContext.Provider value={{ reverb, setReverb }}>
      {children}
    </SlowedReverbContext.Provider>
  );
};

export const useReverb = () => {
  const context = useContext(SlowedReverbContext);
  if (!context) {
    throw new Error("useReverb must be used within a ReverbProvider");
  }
  return context;
};