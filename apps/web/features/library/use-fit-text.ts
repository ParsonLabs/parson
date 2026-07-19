"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function useFitText(dependency: unknown, minimum = 28, maximum = 64) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLHeadingElement | null>(null);
  const [fontSize, setFontSize] = useState(maximum);
  const [wrapped, setWrapped] = useState(false);

  useLayoutEffect(() => {
    const fit = () => {
      const text = textRef.current;
      const wrapper = wrapperRef.current;
      if (!text || !wrapper?.clientWidth) return;
      const styles = window.getComputedStyle(text);
      const probe = document.createElement("span");
      probe.textContent = String(dependency ?? "");
      probe.style.position = "fixed";
      probe.style.left = "-100000px";
      probe.style.top = "0";
      probe.style.visibility = "hidden";
      probe.style.whiteSpace = "nowrap";
      probe.style.fontFamily = styles.fontFamily;
      probe.style.fontWeight = styles.fontWeight;
      probe.style.fontStyle = styles.fontStyle;
      probe.style.letterSpacing = styles.letterSpacing;
      document.body.appendChild(probe);
      const widthAt = (size: number) => {
        probe.style.fontSize = `${size}px`;
        return probe.getBoundingClientRect().width;
      };
      let low = minimum;
      let high = maximum;
      for (let index = 0; index < 12; index += 1) {
        const midpoint = (low + high) / 2;
        if (widthAt(midpoint) <= wrapper.clientWidth) low = midpoint;
        else high = midpoint;
      }
      const next = Math.floor(low);
      setWrapped(widthAt(minimum) > wrapper.clientWidth);
      probe.remove();
      text.style.fontSize = `${next}px`;
      setFontSize(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [dependency, maximum, minimum]);

  return { fontSize, textRef, wrapped, wrapperRef };
}
