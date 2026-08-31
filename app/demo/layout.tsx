import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Todero demo",
  description: "A static work-item fixture. No login.",
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
