"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function PlayerMoreMenu({
  children,
  label = "More controls",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverFocus = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
    }
    closeTimer.current = null;
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        if (!next) {
          hovering.current = false;
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        asChild
        onPointerDown={(event) => {
          if (hovering.current) {
            event.preventDefault();
            hovering.current = false;
            cancelClose();
            setOpen(true);
          }
        }}
      >
        <button
          ref={triggerRef}
          aria-label={label}
          className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 hover:bg-white/8 hover:text-white"
          type="button"
          onPointerEnter={(event) => {
            if (event.pointerType !== "mouse") {
              return;
            }
            cancelClose();
            if (!open) {
              hovering.current = true;
              hoverFocus.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
            }
            setOpen(true);
          }}
          onPointerLeave={() => {
            if (hovering.current) {
              closeSoon();
            }
          }}
        >
          <Ellipsis className="h-5 w-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        collisionPadding={8}
        className="z-120 w-56"
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Node && triggerRef.current?.contains(target)) {
            event.preventDefault();
          }
          if (
            hovering.current &&
            event.detail.originalEvent.type === "focusin"
          ) {
            event.preventDefault();
          }
        }}
        onFocus={(event) => {
          if (
            hovering.current &&
            event.target === event.currentTarget &&
            hoverFocus.current?.isConnected
          ) {
            hoverFocus.current.focus();
          }
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={() => {
          if (hovering.current) {
            closeSoon();
          }
        }}
        onCloseAutoFocus={(event) => {
          if (hovering.current) {
            event.preventDefault();
          }
        }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
