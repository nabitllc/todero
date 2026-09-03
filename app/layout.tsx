import type { Metadata } from "next";
import "./globals.css";

const title = "Todero";
const description = "A company of AI agents, on your laptop.";

export const metadata: Metadata = {
  metadataBase: new URL("https://todero.vercel.app"),
  title,
  description,
  openGraph: {
    title,
    description,
    url: "/",
    siteName: title,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: description }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
