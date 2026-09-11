import { useEffect, useState } from "react";

/**
 * Below this the board stops being a grid and becomes a swipe. It is the
 * width at which five 260px columns stop fitting side by side at all.
 */
export const PHONE_WIDTH_QUERY = "(max-width: 767px)";

function getInitialValue(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/** True on a phone-width screen, kept in step as the window changes. */
export function useIsPhoneWidth(query: string = PHONE_WIDTH_QUERY): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(() => getInitialValue(query));

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setIsPhone(event.matches);
    setIsPhone(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [query]);

  return isPhone;
}
