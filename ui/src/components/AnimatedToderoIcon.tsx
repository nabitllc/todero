import type { SVGProps } from "react";
import { cn } from "../lib/utils";

export function AnimatedToderoIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="-1 -1 26 26"
      className={cn("todero-thinking-icon", className)}
      aria-hidden="true"
      {...props}
    >
      <path
        className="todero-thinking-icon-path"
        d="M12 3 a9 9 0 1 0 0.001 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Full-page loading state: a large, centered, gray animated todero. */
export function ToderoLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("flex min-h-dvh w-full items-center justify-center", className)}
    >
      <AnimatedToderoIcon className="h-24 w-24 text-muted-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
