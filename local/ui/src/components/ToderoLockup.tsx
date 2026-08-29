import type { SVGProps } from "react";

interface ToderoLockupProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  decorative?: boolean;
  title?: string;
}

export function ToderoLockup({
  decorative = false,
  title = "Todero",
  className,
  ...rest
}: ToderoLockupProps) {
  return (
    <span
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : title}
    >
      Todero
    </span>
  );
}
