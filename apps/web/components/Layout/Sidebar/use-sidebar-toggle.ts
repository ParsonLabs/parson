import { useEffect, useState } from 'react';

interface useSidebarToggleStore {
  isOpen: boolean;
  setIsOpen: () => void;
}

export const useSidebarToggle = (): useSidebarToggleStore => {
  const [isOpen, setIsOpenState] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const savedState = localStorage.getItem('sidebarOpen');
      return savedState !== null ? JSON.parse(savedState) : true;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('sidebarOpen', JSON.stringify(isOpen));
    }
  }, [isOpen]);

  const setIsOpen = () => {
    setIsOpenState(prevState => !prevState);
  };

  return { isOpen, setIsOpen };
};