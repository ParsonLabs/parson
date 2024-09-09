"use client"

import { createContext, useState } from 'react';

export const AIContext = createContext({
  isAIVisible: false,
  toggleAI: () => {},
});

type AIPanelProviderProps = {
  children: React.ReactNode
}

export default function AIProvider({ children }: AIPanelProviderProps) {
  const [isAIVisible, setAIVisible] = useState(false);

  const toggleAI = () => {
    setAIVisible(prev => !prev);
  };

  return (
    <AIContext.Provider value={{ isAIVisible, toggleAI }}>
      {children}
    </AIContext.Provider>
  );
};