import * as React from "react";
import { cn } from "@/lib/cn";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-24 w-full rounded-md border border-white/10 bg-black px-3 py-2 text-sm text-white shadow-none outline-none placeholder:text-zinc-600 focus-visible:border-white/25 focus-visible:ring-1 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
