import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/cn";

type ButtonVariant =
  "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variants: Record<ButtonVariant, string> = {
  default: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  destructive: "bg-red-600 text-white hover:bg-red-500",
  outline:
    "border border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700 hover:text-white",
  secondary: "bg-zinc-800 text-zinc-100 hover:bg-zinc-700",
  ghost: "text-zinc-400 hover:bg-white/[0.06] hover:text-white",
  link: "text-zinc-300 underline-offset-4 hover:text-white hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  default: "h-10 px-4 py-2",
  sm: "h-9 rounded-md px-3",
  lg: "h-11 rounded-md px-8",
  icon: "h-10 w-10",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-black transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
          variants[variant ?? "default"],
          sizes[size ?? "default"],
          className,
        )}
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
