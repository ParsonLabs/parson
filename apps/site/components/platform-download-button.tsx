"use client";

import { Download } from "lucide-react";
import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useState } from "react";

type Platform =
  "windows" | "android" | "ios" | "macos" | "linux" | "chromeos" | "unknown";

type PlatformIcon = ComponentType<SVGProps<SVGSVGElement>>;

function WindowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M2 4.4 10.1 3v8.2H2V4.4Zm9.2-1.6L22 1v10.2H11.2V2.8ZM2 12.3h8.1v8.2L2 19.1v-6.8Zm9.2 0H22V22l-10.8-1.8v-7.9Z" />
    </svg>
  );
}

function AndroidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m17.6 9.2 1.8-3.1a.7.7 0 0 0-1.2-.7l-1.8 3a10 10 0 0 0-8.8 0l-1.8-3a.7.7 0 1 0-1.2.7l1.8 3.1A8.8 8.8 0 0 0 3 16.3h18a8.8 8.8 0 0 0-3.4-7.1ZM8.2 13a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm7.6 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2ZM3 17.5h18V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.5Z" />
    </svg>
  );
}

function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.1 12.5c0-2.7 2.2-4 2.3-4.1a5 5 0 0 0-3.9-2.1c-1.7-.2-3.2 1-4 1-1 0-2.4-1-3.9-1-2 0-3.8 1.1-4.8 2.8-2.1 3.5-.5 8.8 1.4 11.7.9 1.4 2 2.9 3.5 2.8 1.4-.1 1.9-.9 3.7-.9 1.7 0 2.2.9 3.7.9 1.5 0 2.5-1.4 3.4-2.8 1.1-1.6 1.5-3.2 1.5-3.3-.1 0-2.9-1.1-2.9-4Zm-2.7-8c.8-1 1.3-2.3 1.2-3.5-1.2 0-2.5.8-3.4 1.7-.7.8-1.4 2.1-1.2 3.4 1.3.1 2.6-.7 3.4-1.6Z" />
    </svg>
  );
}

function LinuxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg data-platform-icon="linux" viewBox="0 0 216 256" {...props}>
      <image href="/brand/tux.svg" width="216" height="256" />
    </svg>
  );
}

function ChromeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2a10 10 0 0 0-8.7 15l4.3-7.4A5.2 5.2 0 0 1 12 6.8h8.6A10 10 0 0 0 12 2Zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9.2 0h-8.6a5.2 5.2 0 0 1 4.4 7.8l-4.3 7.4A10 10 0 0 0 21.2 8ZM6.7 10.4l-4.3 7.4A10 10 0 0 0 11.5 22l4.3-7.4a5.2 5.2 0 0 1-9.1-4.2Z" />
    </svg>
  );
}

const platformDetails = {
  windows: { label: "Windows", Icon: WindowsIcon },
  android: { label: "Android", Icon: AndroidIcon },
  ios: { label: "iPhone", Icon: AppleIcon },
  macos: { label: "macOS", Icon: AppleIcon },
  linux: { label: "Linux", Icon: LinuxIcon },
  chromeos: { label: "ChromeOS", Icon: ChromeIcon },
  unknown: { label: "your device", Icon: Download },
} satisfies Record<Platform, { label: string; Icon: PlatformIcon }>;

function detectPlatform(): Platform {
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  if (/android/.test(source)) return "android";
  if (/iphone|ipad|ipod/.test(source)) return "ios";
  if (/cros/.test(source)) return "chromeos";
  if (/windows|win32|win64/.test(source)) return "windows";
  if (/macintosh|mac os|macintel/.test(source)) return "macos";
  if (/linux|x11/.test(source)) return "linux";
  return "unknown";
}

export default function PlatformDownloadButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => setPlatform(detectPlatform()), []);

  const { label, Icon } = platform
    ? platformDetails[platform]
    : { label: "Parson", Icon: Download };
  const buttonLabel = platform ? `Download for ${label}` : "Download Parson";

  return (
    <Link
      className="landing-primary-button landing-platform-download"
      href={
        platform
          ? `/docs/download-and-install?platform=${platform}`
          : "/docs/download-and-install"
      }
      title={platform ? `Download Parson for ${label}` : "Download Parson"}
    >
      <span className="landing-platform-download-content">
        <Icon aria-hidden="true" size={17} />
        <span>{compact ? "Download" : buttonLabel}</span>
      </span>
    </Link>
  );
}
