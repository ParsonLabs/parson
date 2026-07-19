import Image from "next/image";

export default function ParsonBrandMark({ className }: { className?: string }) {
  return (
    <Image
      aria-hidden="true"
      className={className}
      alt=""
      height={64}
      src="/icons/icon.svg"
      width={64}
    />
  );
}
