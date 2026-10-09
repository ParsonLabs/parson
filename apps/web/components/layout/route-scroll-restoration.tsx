"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, type RefObject } from "react";

export default function RouteScrollRestoration({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const routeKey = `${pathname}?${search}`;
  const positions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const target = positions.current.get(routeKey) ?? 0;
    let restoring = true;
    let navigating = false;
    let frame = 0;
    const save = () => {
      if (restoring || navigating) {
        return;
      }
      positions.current.set(routeKey, container.scrollTop);
      if (positions.current.size > 100) {
        positions.current.delete(positions.current.keys().next().value!);
      }
    };
    const stopRestoring = () => {
      restoring = false;
      navigating = false;
      observer.disconnect();
      save();
    };
    const restore = () => {
      if (!restoring) {
        return;
      }
      container.scrollTop = target;
      if (container.scrollHeight - container.clientHeight >= target) {
        stopRestoring();
      }
    };
    const observer = new MutationObserver(restore);
    const beforeNavigation = (event?: Event) => {
      if (
        event instanceof CustomEvent &&
        event.detail?.href ===
          `${window.location.pathname}${window.location.search}`
      ) {
        return;
      }
      save();
      navigating = true;
    };
    const onLinkClick = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        link &&
        link.origin === window.location.origin &&
        link.href !== window.location.href &&
        !link.hasAttribute("download") &&
        (!link.target || link.target === "_self")
      ) {
        beforeNavigation();
      }
    };
    observer.observe(container, { childList: true, subtree: true });
    container.scrollTop = target;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore);
    });
    document.addEventListener("click", onLinkClick, true);
    window.addEventListener("popstate", beforeNavigation);
    window.addEventListener("parson:search-submitted", beforeNavigation);
    container.addEventListener("scroll", save, { passive: true });
    container.addEventListener("wheel", stopRestoring, { passive: true });
    container.addEventListener("touchstart", stopRestoring, { passive: true });
    container.addEventListener("keydown", stopRestoring);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", onLinkClick, true);
      window.removeEventListener("popstate", beforeNavigation);
      window.removeEventListener("parson:search-submitted", beforeNavigation);
      container.removeEventListener("scroll", save);
      container.removeEventListener("wheel", stopRestoring);
      container.removeEventListener("touchstart", stopRestoring);
      container.removeEventListener("keydown", stopRestoring);
    };
  }, [containerRef, routeKey]);

  return null;
}
