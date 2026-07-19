"use client";

import { useEffect, useState } from "react";
import PlatformDownloadButton from "./platform-download-button";

export default function StickyDownloadButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const heroDownload = document.getElementById("hero-download");
    if (!heroDownload) return;

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0.15 },
    );

    observer.observe(heroDownload);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      className={`landing-sticky-download ${visible ? "visible" : ""}`}
      aria-hidden={!visible}
    >
      <PlatformDownloadButton compact />
    </span>
  );
}
