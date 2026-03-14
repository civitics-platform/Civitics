import * as React from "react";
import { cn } from "../lib/cn";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "democrat" | "republican" | "independent" | "neutral" | "agency" | "proposal";
}

const variantClasses: Record<NonNullable<BadgeProps["variant"]>, string> = {
  democrat: "border-blue-500 text-blue-700 bg-blue-50",
  republican: "border-red-500 text-red-700 bg-red-50",
  independent: "border-purple-500 text-purple-700 bg-purple-50",
  neutral: "border-gray-300 text-gray-700 bg-gray-50",
  agency: "border-gray-400 text-gray-800 bg-gray-100",
  proposal: "border-amber-400 text-amber-800 bg-amber-50",
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}
