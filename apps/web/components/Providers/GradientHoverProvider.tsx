"use client"

import { ReactNode, createContext, useState, useContext } from 'react';

interface GradientHoverContextType {
  gradient: string;
  setGradient: React.Dispatch<React.SetStateAction<string>>;
}

const GradientHoverContext = createContext<GradientHoverContextType | undefined>(undefined);

export const GradientHoverProvider = ({ children }: { children: ReactNode }) => {
  const [gradient, setGradient] = useState<string>('#CBC3E3');

  return (
    <GradientHoverContext.Provider value={{ gradient, setGradient }}>
      {children}
    </GradientHoverContext.Provider>
  );
};

export const useGradientHover = (): GradientHoverContextType => {
  const context = useContext(GradientHoverContext);
  if (!context) {
    throw new Error('useGradientHover must be used within a GradientHoverProvider');
  }
  return context;
};