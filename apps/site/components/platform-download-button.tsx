"use client";

import { Download } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { useEffect, useState } from "react";

import { releaseDownloads } from "../lib/release-downloads";

type Platform =
  "windows" | "android" | "ios" | "macos" | "linux" | "chromeos" | "unknown";
type Architecture = "arm64" | "x64" | "unknown";
type PlatformSelection = {
  architecture: Architecture;
  platform: Platform;
};

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
  windows: {
    label: "Windows x64",
    Icon: WindowsIcon,
    href: releaseDownloads.windowsX64,
    available: true,
    direct: true,
  },
  android: {
    label: "Android",
    Icon: AndroidIcon,
    href: "/docs/download-and-install?platform=android",
    available: false,
    direct: false,
  },
  ios: {
    label: "iPhone",
    Icon: AppleIcon,
    href: "/docs/download-and-install?platform=ios",
    available: false,
    direct: false,
  },
  macos: {
    label: "macOS",
    Icon: AppleIcon,
    href: "/docs/download-and-install?platform=macos",
    available: true,
    direct: false,
  },
  linux: {
    label: "Linux x64",
    Icon: LinuxIcon,
    href: releaseDownloads.linuxX64AppImage,
    available: true,
    direct: true,
  },
  chromeos: {
    label: "ChromeOS",
    Icon: ChromeIcon,
    href: "/docs/download-and-install?platform=chromeos",
    available: false,
    direct: false,
  },
  unknown: {
    label: "your device",
    Icon: Download,
    href: "/docs/download-and-install",
    available: false,
    direct: false,
  },
} satisfies Record<
  Platform,
  {
    label: string;
    Icon: PlatformIcon;
    href: string;
    available: boolean;
    direct: boolean;
  }
>;

function architectureFrom(value: string): Architecture {
  if (/arm64|aarch64|armv8|arm.*64/.test(value)) return "arm64";
  if (/x86_64|x86-64|x86.*64|amd64|win64|wow64|x64/.test(value)) return "x64";
  return "unknown";
}

async function detectPlatform(): Promise<PlatformSelection> {
  const source = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  const platform = /android/.test(source)
    ? "android"
    : /iphone|ipad|ipod/.test(source)
      ? "ios"
      : /cros/.test(source)
        ? "chromeos"
        : /windows|win32|win64/.test(source)
          ? "windows"
          : /macintosh|mac os|macintel/.test(source)
            ? "macos"
            : /linux|x11/.test(source)
              ? "linux"
              : "unknown";
  let architecture = architectureFrom(source);
  const userAgentData = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (
          hints: string[],
        ) => Promise<{ architecture?: string; bitness?: string }>;
      };
    }
  ).userAgentData;
  if (userAgentData?.getHighEntropyValues) {
    try {
      const values = await userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
      ]);
      const detected = architectureFrom(
        `${values.architecture ?? ""} ${values.bitness ?? ""}`,
      );
      if (detected !== "unknown") architecture = detected;
    } catch {
      // Browser architecture hints are optional.
    }
  }
  return { architecture, platform };
}

function detailsFor({ architecture, platform }: PlatformSelection) {
  if (platform === "windows" && architecture === "arm64")
    return {
      ...platformDetails.windows,
      label: "Windows ARM64",
      href: releaseDownloads.windowsArm64,
    };
  if (platform === "linux" && architecture === "arm64")
    return {
      ...platformDetails.linux,
      label: "Linux ARM64",
      href: releaseDownloads.linuxArm64AppImage,
    };
  if (platform === "macos" && architecture !== "unknown")
    return {
      ...platformDetails.macos,
      label: architecture === "arm64" ? "macOS Apple Silicon" : "macOS Intel",
      href:
        architecture === "arm64"
          ? releaseDownloads.macArm64Dmg
          : releaseDownloads.macX64Dmg,
      direct: true,
    };
  return platformDetails[platform];
}

export default function PlatformDownloadButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [selection, setSelection] = useState<PlatformSelection | null>(null);

  useEffect(() => {
    let current = true;
    void detectPlatform().then((detected) => {
      if (current) setSelection(detected);
    });
    return () => {
      current = false;
    };
  }, []);

  const { label, Icon, href, available, direct } = selection
    ? detailsFor(selection)
    : {
        label: "Parson",
        Icon: Download,
        href: "/docs/download-and-install",
        available: false,
        direct: false,
      };
  const buttonLabel = !available
    ? "View install options"
    : direct
      ? `Download for ${label}`
      : `View downloads for ${label}`;
  const external = href.startsWith("https://");

  return (
    <a
      className="landing-primary-button landing-platform-download"
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
      title={direct ? `Download Parson for ${label}` : buttonLabel}
    >
      <span className="landing-platform-download-content">
        <Icon aria-hidden="true" size={17} />
        <span>
          {compact
            ? direct
              ? "Download"
              : available
                ? "Downloads"
                : "Install guide"
            : buttonLabel}
        </span>
      </span>
    </a>
  );
}
