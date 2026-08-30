import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Todero",
  description: "A local company for AI agents. Your model, your Second Brain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
