import ParsonBrandMark from "@/components/icons/parson-brand-mark";
import type { ReactNode } from "react";

export default function UnprotectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-5 top-4 z-10 hidden sm:block">
        <ParsonBrandMark className="h-9 w-9" />
      </div>
      {children}
    </div>
  );
}
