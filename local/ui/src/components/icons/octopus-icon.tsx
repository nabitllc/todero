import { createLucideIcon } from "lucide-react";

/**
 * Todero's octopus brand mark, as a `lucide-react` icon.
 *
 * lucide-react has no Octopus icon. This keeps the same props and
 * `LucideIcon` type as other source badges (GitHub, folder, etc.).
 */
export const OctopusIcon = createLucideIcon("octopus", [
  [
    "path",
    {
      d: "M7.5 12c0-3.1 2-5.5 4.5-5.5s4.5 2.4 4.5 5.5c0 1.8-1.3 3.2-3 3.2h-3C8.8 15.2 7.5 13.8 7.5 12z",
      key: "head",
    },
  ],
  ["circle", { cx: "10.3", cy: "10.7", r: "0.85", fill: "currentColor", stroke: "none", key: "leye" }],
  ["circle", { cx: "13.7", cy: "10.7", r: "0.85", fill: "currentColor", stroke: "none", key: "reye" }],
  ["path", { d: "M9 15.3c-1.1 2.3-2.8 3.5-2.2 5.2", key: "t1" }],
  ["path", { d: "M11 15.4c-.5 2.2-1.1 4 .4 5.1", key: "t2" }],
  ["path", { d: "M13 15.4c.5 2.2 1.1 4-.4 5.1", key: "t3" }],
  ["path", { d: "M15 15.3c1.1 2.3 2.8 3.5 2.2 5.2", key: "t4" }],
  ["path", { d: "M8 13.4c-2.3.6-3.7 1.6-3.3 3.6", key: "t5" }],
  ["path", { d: "M16 13.4c2.3.6 3.7 1.6 3.3 3.6", key: "t6" }],
]);
