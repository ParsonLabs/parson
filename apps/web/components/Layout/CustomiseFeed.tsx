"use client";

import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@music/ui/components/popover";
import { Eye, EyeOff, LayoutDashboard, Pin, X, Settings } from "lucide-react";
import { Sortable, SortableDragHandle, SortableItem } from "@music/ui/components/sortable";
import { DragHandleDots2Icon } from "@radix-ui/react-icons";
import { arrayMove } from "@dnd-kit/sortable";
import { useLayoutConfig } from "../Providers/LayoutConfigContext";
import { Separator } from "@music/ui/components/separator";
import { Button } from "@music/ui/components/button";
import { motion } from "framer-motion";
import { useMediaQuery } from "../Hooks/useMediaQuery";

interface CustomiseFeedProps {
  onClose?: () => void;
  isMobileSheet?: boolean;
}

export default function CustomiseFeed({ onClose, isMobileSheet = false }: CustomiseFeedProps) {
  const { components, setComponents } = useLayoutConfig();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const handleVisibilityToggle = (id: string) => {
    setComponents((prevComponents) => {
      const newComponents = prevComponents.map((component) =>
        component.id === id ? { ...component, visible: !component.visible } : component
      );
      saveConfig(newComponents);
      return newComponents;
    });
  };

  const handlePinToggle = (id: string) => {
    setComponents((prevComponents) => {
      const updatedComponents = prevComponents.map((component) =>
        component.id === id ? { ...component, pinned: !component.pinned } : component
      );
      const pinnedComponents = updatedComponents.filter((component) => component.pinned);
      const unpinnedComponents = updatedComponents.filter((component) => !component.pinned);
      const newComponents = [...pinnedComponents, ...unpinnedComponents];
      saveConfig(newComponents);
      return newComponents;
    });
  };

  const handleMove = ({ activeIndex, overIndex }: { activeIndex: number, overIndex: number }) => {
    setComponents((prevComponents) => {
      const newComponents = arrayMove(prevComponents, activeIndex, overIndex);
      saveConfig(newComponents);
      return newComponents;
    });
  };

  const saveConfig = (newComponents = components) => {
    localStorage.setItem("layoutConfig", JSON.stringify(newComponents));
  };

  const CustomizeContent = (
    <>
      <div className="flex items-center justify-between pb-2">
        <h2 className="text-lg font-semibold">Customize Feed</h2>
        {isMobileSheet && (
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>
      
      <Separator className="bg-white/20 my-2" />
      
      <div className="pt-4 pb-2">
        <p className="text-sm text-gray-300 mb-4">Drag to reorder, pin to keep at the top, or toggle visibility.</p>
      </div>

      <Sortable
        value={components}
        onMove={handleMove}
        overlay={
          <div className="grid grid-cols-[1fr,auto] items-center gap-2">
            <div className="h-8 w-full rounded-sm bg-primary/10" />
            <div className="size-8 shrink-0 rounded-sm bg-primary/10" />
          </div>
        }
      >
        <div className="flex w-full flex-col gap-3">
          {components.map((component) => (
            <SortableItem key={component.id} value={component.id} asChild>
              <motion.div 
                className={`flex items-center justify-between p-2 rounded-lg ${component.visible ? 'bg-white/5' : 'bg-black/20'} transition-colors`}
                whileHover={{ backgroundColor: "rgba(255, 255, 255, 0.1)" }}
              >
                <div className="flex items-center">
                  <button 
                    onClick={() => handlePinToggle(component.id)} 
                    className="mr-2 p-1.5 rounded-md hover:bg-white/10 transition-colors"
                    aria-label={component.pinned ? "Unpin from top" : "Pin to top"}
                  >
                    <Pin className={`h-4 w-4 ${component.pinned ? "text-indigo-400" : "text-gray-400"} ${component.pinned ? "rotate-45" : ""} transition-transform`} />
                  </button>
                  <span className={`ml-1 ${!component.visible ? 'text-gray-500' : 'text-gray-100'}`}>{component.name}</span>
                </div>
                <div className="flex items-center">
                  <SortableDragHandle
                    size="icon"
                    className="size-8 shrink-0 mr-2 bg-transparent cursor-grab"
                  >
                    <DragHandleDots2Icon
                      className="size-4 text-gray-400"
                      aria-hidden="true"
                    />
                  </SortableDragHandle>
                  <button 
                    onClick={() => handleVisibilityToggle(component.id)} 
                    className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                    aria-label={component.visible ? "Hide section" : "Show section"}
                  >
                    {component.visible ? (
                      <Eye className="h-4 w-4 text-gray-300" />
                    ) : (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    )}
                  </button>
                </div>
              </motion.div>
            </SortableItem>
          ))}
        </div>
      </Sortable>
    </>
  );

  if (isMobileSheet) {
    return CustomizeContent;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="rounded-full hover:bg-white/10 transition-colors"
          aria-label="Customize feed"
        >
          <Settings className="h-5 w-5 text-white" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-white bg-gray-900/90 backdrop-filter backdrop-blur-lg border border-gray-700 shadow-xl">
        {CustomizeContent}
      </PopoverContent>
    </Popover>
  );
}