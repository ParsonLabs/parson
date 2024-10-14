"use client";

import { cn } from "@music/ui/lib/utils";
import Sidebar from "./Sidebar";

export default function AdminPanelLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // const sidebar = useStore(useSidebarToggle, (state) => state);

  // if (!sidebar) return null;
  let sidebar = {
    isOpen: true
  }

  return (
    <>
      <Sidebar />
      <main
        className={cn(
          "min-h-[calc(100vh_-_56px)] bg-zinc-50 dark:bg-zinc-900 transition-[margin-left] ease-in-out duration-300",
          sidebar?.isOpen === false ? "lg:ml-[90px]" : "lg:ml-72"
        )}
        >
        {children}
      </main>
    </>
  );
}
