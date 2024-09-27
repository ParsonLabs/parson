"use client";

import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@music/ui/components/popover";
import { Eye, EyeOff, LayoutDashboard, Pin } from "lucide-react";
import { Sortable, SortableDragHandle, SortableItem } from "@music/ui/components/sortable";
import { DragHandleDots2Icon } from "@radix-ui/react-icons";
import { arrayMove } from "@dnd-kit/sortable";
import { useLayoutConfig } from "../Providers/LayoutConfigContext";
import { Separator } from "@music/ui/components/separator";

export default function CustomiseFeed() {
  const { components, setComponents } = useLayoutConfig();

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <LayoutDashboard  className="hover:text-gray-500 duration-150 transition-colors"/>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-white bg-gray-800 bg-opacity-30 backdrop-filter backdrop-blur-lg border border-gray-700">
        <h1 className="pb-2">Customise Feed</h1>
        <Separator className="bg-white"/>

        <div className="pt-8"/>

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
          <div className="flex w-full flex-col gap-2">
            {components.map((component) => (
              <SortableItem key={component.id} value={component.id} asChild>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <button onClick={() => handlePinToggle(component.id)} className="mr-2">
                      <Pin className={component.pinned ? "text-purple-400" : "text-gray-500"} />
                    </button>
                    <span className="ml-2">{component.name}</span>
                  </div>
                  <div className="flex items-center">
                    <SortableDragHandle
                      size="icon"
                      className="size-8 shrink-0 mr-2 bg-transparent"
                    >
                      <DragHandleDots2Icon
                        className="size-4"
                        aria-hidden="true"
                      />
                    </SortableDragHandle>
                    {component.visible ? (
                      <Eye onClick={() => handleVisibilityToggle(component.id)} />
                    ) : (
                      <EyeOff onClick={() => handleVisibilityToggle(component.id)} />
                    )}
                  </div>
                </div>
              </SortableItem>
            ))}
          </div>
        </Sortable>
      </PopoverContent>
    </Popover>
  );
}