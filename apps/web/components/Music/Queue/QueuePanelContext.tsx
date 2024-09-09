"use client"

import { createContext, useState } from 'react';

export const PanelContext = createContext({
  isPanelVisible: false,
  togglePanel: () => {},
});

type PanelProviderProps = {
  children: React.ReactNode
}

export default function PanelProvider({ children }: PanelProviderProps) {
  const [isPanelVisible, setPanelVisible] = useState(false);

  const togglePanel = () => {
    setPanelVisible(prev => !prev);
  };

  return (
    <PanelContext.Provider value={{ isPanelVisible, togglePanel }}>
      {children}
    </PanelContext.Provider>
  );
};