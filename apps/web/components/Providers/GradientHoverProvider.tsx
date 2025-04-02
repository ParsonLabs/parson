"use client"

import { ReactNode, createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';

interface GradientHoverContextType {
  gradient: string;
  previousGradient: string;
  isTransitioning: boolean;
  transitionDuration: number;
  setGradient: (color: string) => void;
  setGradientWithTransition: (color: string, duration?: number) => void;
  resetTransition: () => void;
  clearGradient: () => void;
}

const GradientHoverContext = createContext<GradientHoverContextType | undefined>(undefined);

export const GradientHoverProvider = ({ 
  children,
  defaultColor = '#CBC3E3',
  defaultDuration = 800
}: { 
  children: ReactNode;
  defaultColor?: string;
  defaultDuration?: number;
}) => {
  const [gradient, setGradientState] = useState<string>(defaultColor);
  const [previousGradient, setPreviousGradient] = useState<string>(defaultColor);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [transitionDuration, setTransitionDuration] = useState<number>(defaultDuration);
  const transitionTimer = useRef<NodeJS.Timeout | null>(null);
  const lastSetTime = useRef<number>(0);
  
  const clearTimer = useCallback(() => {
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  }, []);

  const setGradient = useCallback((color: string) => {
    clearTimer();
    setGradientState(color);
    setPreviousGradient(color);
    setIsTransitioning(false);
    lastSetTime.current = Date.now();
  }, [clearTimer]);
  
  const clearGradient = useCallback(() => {
    const timeSinceLastSet = Date.now() - lastSetTime.current;
    if (timeSinceLastSet > 500) {
      clearTimer();
      setGradientState(defaultColor);
      setPreviousGradient(defaultColor);
      setIsTransitioning(false);
    }
  }, [clearTimer, defaultColor]);

  const setGradientWithTransition = useCallback((color: string, duration?: number) => {
    const now = Date.now();
    const timeSinceLastSet = now - lastSetTime.current;
    
    if (timeSinceLastSet < 100) return;
    lastSetTime.current = now;
    
    if (color !== gradient) {
      clearTimer();
      
      setPreviousGradient(gradient);
      setGradientState(color);
      setIsTransitioning(true);
      
      const transitionTime = duration !== undefined ? duration : transitionDuration;
      
      transitionTimer.current = setTimeout(() => {
        setIsTransitioning(false);
      }, transitionTime);
    }
  }, [gradient, transitionDuration, clearTimer]);

  const resetTransition = useCallback(() => {
    clearTimer();
    setIsTransitioning(false);
  }, [clearTimer]);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  return (
    <GradientHoverContext.Provider value={{ 
      gradient, 
      previousGradient,
      isTransitioning,
      transitionDuration,
      setGradient,
      setGradientWithTransition,
      resetTransition,
      clearGradient
    }}>
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