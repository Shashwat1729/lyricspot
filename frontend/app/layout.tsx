import type { Metadata, Viewport } from "next";
// Fonts are bundled from npm (@fontsource) rather than next/font/google so
// builds never depend on reaching Google Fonts (CI, Docker, offline).
import "@fontsource/bricolage-grotesque/latin-500.css";
import "@fontsource/bricolage-grotesque/latin-700.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./globals.css";

// Next applies basePath to page links but not to metadata icon/manifest
// URLs, so prefix them explicitly (empty locally, "/lyricspot" on Pages).
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "LyricSpot — sing a line, find the song",
  description:
    "Sing or type the one lyric stuck in your head. LyricSpot finds the song and drops you at the exact second that line plays.",
  keywords: ["lyrics", "song finder", "identify song by lyrics", "sing to search", "Spotify", "music"],
  authors: [{ name: "Shashwat Bajpai", url: "https://github.com/Shashwat1729" }],
  icons: { icon: base + "/favicon.svg" },
  manifest: base + "/manifest.json",
  openGraph: {
    title: "LyricSpot",
    description: "Sing a line, find the song, keep listening from that exact second.",
    type: "website",
    siteName: "LyricSpot",
  },
  twitter: { card: "summary", title: "LyricSpot", description: "Sing a line, find the song." },
};

export const viewport: Viewport = {
  themeColor: "#0E0F0C",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
