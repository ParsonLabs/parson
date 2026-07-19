import * as React from "react";

import { cn } from "@/lib/cn";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-base text-zinc-200 ring-offset-black file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-zinc-200 placeholder:text-zinc-600 focus-visible:border-zinc-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
