"use client";

import { useEffect, useRef } from "react";

export const NATIVE_DRAG_OPT_IN_SELECTOR = '[data-native-drag="true"]';

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

export function allowsNativeDrag(target: EventTarget | null) {
  if (!target) return false;
  const candidate = target as unknown as Partial<ClosestTarget>;
  if (typeof candidate.closest !== "function") return false;
  return Boolean(candidate.closest(NATIVE_DRAG_OPT_IN_SELECTOR));
}

export function allowsNativeDrop(
  intentionalDrag: boolean,
  target: EventTarget | null,
) {
  return intentionalDrag && allowsNativeDrag(target);
}

export default function NativeDragGuard() {
  const intentionalDrag = useRef(false);

  useEffect(() => {
    const guardDragStart = (event: DragEvent) => {
      intentionalDrag.current = allowsNativeDrag(event.target);
      if (!intentionalDrag.current) event.preventDefault();
    };
    const guardDragDestination = (event: DragEvent) => {
      if (!allowsNativeDrop(intentionalDrag.current, event.target)) {
        event.preventDefault();
      }
    };
    const finishDrag = () => {
      intentionalDrag.current = false;
    };
    const guardDrop = (event: DragEvent) => {
      if (!allowsNativeDrop(intentionalDrag.current, event.target)) {
        event.preventDefault();
      }
      finishDrag();
    };

    document.addEventListener("dragstart", guardDragStart, true);
    document.addEventListener("dragover", guardDragDestination, true);
    document.addEventListener("drop", guardDrop, true);
    document.addEventListener("dragend", finishDrag, true);
    return () => {
      document.removeEventListener("dragstart", guardDragStart, true);
      document.removeEventListener("dragover", guardDragDestination, true);
      document.removeEventListener("drop", guardDrop, true);
      document.removeEventListener("dragend", finishDrag, true);
    };
  }, []);

  return null;
}
