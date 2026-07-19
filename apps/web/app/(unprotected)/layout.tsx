import type { ReactNode } from "react";
import Image from "next/image";

export default function UnprotectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="fixed left-5 top-4 z-10 hidden sm:block">
        <Image
          alt="Parson"
          className="h-5 w-auto"
          height={64}
          priority
          src="/images/brand/parson-wordmark.svg"
          width={220}
        />
      </div>
      {children}
    </div>
  );
}
