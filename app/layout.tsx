import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Todero",
  description: "A company of AI agents, on your laptop.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
