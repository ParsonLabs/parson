"use client";

import { Home, Library, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ParsonBrandMark from "@/components/icons/parson-brand-mark";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/library", label: "Library", icon: Library },
];

const mobileNavigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const handleNavigate = (href: string) => {
    if (href === "/") {
      window.dispatchEvent(new Event("parson:navigate-home"));
    }
  };

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <>
      <aside
        aria-label="Main navigation"
        className="fixed bottom-0 left-0 top-0 z-50 hidden w-[80px] bg-black md:block"
      >
        <div className="flex h-full flex-col px-4 md:items-center md:px-0">
          <Link
            href="/"
            aria-label="Parson home"
            className="mt-3 flex h-12 items-center gap-3 md:w-12 md:justify-center"
            onClick={() => handleNavigate("/")}
          >
            <ParsonBrandMark className="h-16 w-16 shrink-0 text-white" />
            <span className="text-base font-semibold md:hidden">Parson</span>
          </Link>

          <nav className="mt-8 flex w-full flex-col gap-2 md:items-center">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);

              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label}
                  title={label}
                  onClick={() => handleNavigate(href)}
                  className={`flex h-11 w-full items-center gap-3 rounded-[14px] px-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black md:w-11 md:justify-center md:px-0 ${
                    active
                      ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                      : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300"
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                  <span className="text-sm font-medium md:hidden">{label}</span>
                </Link>
              );
            })}
          </nav>

          <Link
            aria-label="Settings"
            className={`mb-4 mt-auto flex h-11 w-full items-center gap-3 rounded-[14px] px-3 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-2 focus-visible:ring-offset-black md:w-11 md:justify-center md:px-0 ${
              pathname === "/settings"
                ? "bg-white/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                : "text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300"
            }`}
            href="/settings"
            onClick={() => handleNavigate("/settings")}
            title="Settings"
          >
            <Settings className="h-5 w-5" strokeWidth={1.8} />
            <span className="text-sm font-medium md:hidden">Settings</span>
          </Link>
        </div>
      </aside>

      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-50 flex h-[72px] items-stretch border-t border-white/10 bg-black/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        {mobileNavigation.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              onClick={() => handleNavigate(href)}
              className={`flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                active ? "text-white" : "text-zinc-600 active:text-zinc-300"
              }`}
            >
              <Icon
                className="h-[22px] w-[22px]"
                strokeWidth={active ? 2.2 : 1.8}
              />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
