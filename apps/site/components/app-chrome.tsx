"use client";

import { useSearchContext } from "fumadocs-ui/contexts/search";
import {
  BookOpen,
  CircleHelp,
  Headphones,
  Home,
  Menu,
  Search,
  ShieldCheck,
  SquareLibrary,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const railDestinations = [
  { href: "/docs", label: "Home", icon: Home },
  { href: "/docs/library", label: "Library", icon: BookOpen },
  { href: "/docs/listening", label: "Listening", icon: Headphones },
  {
    href: "/docs/accounts-privacy-security",
    label: "Keep it safe",
    icon: ShieldCheck,
  },
  { href: "/docs/performance", label: "Reference", icon: SquareLibrary },
];

const docsSections = [
  {
    links: [
      { href: "/docs", label: "Home" },
      { href: "/docs/start-here", label: "Start here" },
      { href: "/docs/download-and-install", label: "Download and install" },
    ],
  },
  {
    title: "Library",
    links: [
      { href: "/docs/library", label: "Library" },
      { href: "/docs/supported-files", label: "Supported files" },
      { href: "/docs/rescanning", label: "Rescanning and file changes" },
    ],
  },
  {
    title: "Use Parson",
    links: [
      { href: "/docs/listening", label: "Listening" },
      { href: "/docs/lyrics", label: "Lyrics" },
      {
        href: "/docs/playlists-likes-history",
        label: "Playlists, likes, and history",
      },
      { href: "/docs/connecting-devices", label: "Connecting devices" },
      { href: "/docs/advanced-networking", label: "Advanced networking" },
    ],
  },
  {
    title: "Keep it safe",
    links: [
      {
        href: "/docs/accounts-privacy-security",
        label: "Accounts, privacy, and security",
      },
      { href: "/docs/data-safety", label: "Data safety" },
      { href: "/docs/updates-and-migrations", label: "Updates and migrations" },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/troubleshooting", label: "Troubleshooting" },
      { href: "/docs/performance", label: "Performance and indexing" },
      { href: "/docs/diagnostics", label: "Diagnostics" },
      { href: "/docs/development", label: "Development" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/docs" ? pathname === href : pathname.startsWith(href);
}

function DocumentationLinks({ pathname }: { pathname: string }) {
  return (
    <nav className="parson-site-navigation" aria-label="Documentation">
      {docsSections.map((section, index) => (
        <div
          className="parson-site-group"
          key={section.title ?? `primary-${index}`}
        >
          {section.title ? <p>{section.title}</p> : null}
          {section.links.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                aria-current={active ? "page" : undefined}
                data-active={active || undefined}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function RailTooltip({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <span className="parson-rail-tooltip" id={id} role="tooltip">
      {children}
    </span>
  );
}

export function AppChrome() {
  const pathname = usePathname();
  const { setOpenSearch } = useSearchContext();

  return (
    <>
      <aside className="parson-app-rail" aria-label="Parson">
        <Link
          aria-describedby="rail-tip-home-logo"
          aria-label="Parson documentation home"
          className="parson-app-logo parson-tooltip-anchor"
          href="/docs"
        >
          <img alt="" aria-hidden="true" src="/icons/icon.svg" />
          <RailTooltip id="rail-tip-home-logo">Parson docs</RailTooltip>
        </Link>
        <nav className="parson-rail-nav">
          {railDestinations.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            const tooltipId = `rail-tip-${label.toLowerCase()}`;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                aria-describedby={tooltipId}
                aria-label={label}
                className="parson-rail-link parson-tooltip-anchor"
                data-active={active || undefined}
                href={href}
                key={href}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                <RailTooltip id={tooltipId}>{label}</RailTooltip>
              </Link>
            );
          })}
        </nav>
        <Link
          aria-describedby="rail-tip-troubleshooting"
          aria-label="Troubleshooting"
          className="parson-rail-link parson-rail-help parson-tooltip-anchor"
          data-active={
            pathname.startsWith("/docs/troubleshooting") || undefined
          }
          href="/docs/troubleshooting"
        >
          <CircleHelp aria-hidden="true" size={20} strokeWidth={1.8} />
          <RailTooltip id="rail-tip-troubleshooting">
            Troubleshooting
          </RailTooltip>
        </Link>
      </aside>

      <aside className="parson-shell-sidebar">
        <p className="parson-shell-sidebar-title">Documentation</p>
        <DocumentationLinks pathname={pathname} />
      </aside>

      <header className="parson-app-topbar">
        <button
          aria-label="Search documentation"
          className="parson-global-search"
          onClick={() => setOpenSearch(true)}
          type="button"
        >
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
          <span>Search Parson docs</span>
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      <div className="parson-mobile-shell">
        <details key={pathname}>
          <summary>
            <Menu aria-hidden="true" size={18} />
            <span>Parson Documentation</span>
          </summary>
          <DocumentationLinks pathname={pathname} />
        </details>
        <button
          aria-label="Search documentation"
          onClick={() => setOpenSearch(true)}
          type="button"
        >
          <Search aria-hidden="true" size={18} />
        </button>
      </div>
    </>
  );
}
