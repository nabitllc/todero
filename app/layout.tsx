import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Todero",
  description: "Todero workspace and empty product board.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
